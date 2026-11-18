import { createHash } from "node:crypto";
import { parseMoneyPlan, type MoneyPlan } from "../domain/money-coach.ts";
import type {
  ExpenseRepository,
  SettingsRepository,
} from "../repositories/types.ts";

export interface MoneyWriteRepositories {
  expenses: ExpenseRepository;
  settings: SettingsRepository;
}

interface ExpenseMetadataAction {
  type: "expense.update_metadata";
  expenseId: string;
  expectedUpdatedAt: string;
  patch: {
    responsibility?: "self" | "other";
    expectedDebitMonth?: string;
    settlementStatus?: "confirmed" | "provisional";
  };
}

interface CommitmentStatusAction {
  type: "commitment.update_status";
  month: string;
  commitmentId: string;
  expectedPlanRevision: string;
  status: "active" | "cancellation_requested" | "cancelled";
  evidence?: string;
}

export interface MoneyWriteRequest {
  schemaVersion: "keiri.write.v1";
  idempotencyKey: string;
  action: ExpenseMetadataAction | CommitmentStatusAction;
}

export type MoneyWriteResult =
  | { type: "expense.update_metadata"; id: string; updatedAt: string }
  | {
      type: "commitment.update_status";
      id: string;
      month: string;
      status: "active" | "cancellation_requested" | "cancelled";
    };

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function digest(value: unknown): string {
  return `sha256:${createHash("sha256").update(stableJson(value)).digest("hex")}`;
}

export function moneyPlanRevision(rawPlan: string | null): string {
  return digest(rawPlan ?? "");
}

function safeId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value);
}

const EXPENSE_PATCH_KEYS = [
  "responsibility",
  "expectedDebitMonth",
  "settlementStatus",
];

function isValidExpensePatch(patch: ExpenseMetadataAction["patch"]): boolean {
  const keys = Object.keys(patch);
  const hasOnlyKnownKeys = keys.every((key) =>
    EXPENSE_PATCH_KEYS.includes(key),
  );
  return (
    keys.length > 0 &&
    hasOnlyKnownKeys &&
    (patch.responsibility === undefined ||
      ["self", "other"].includes(patch.responsibility)) &&
    (patch.expectedDebitMonth === undefined ||
      /^\d{4}-(0[1-9]|1[0-2])$/.test(patch.expectedDebitMonth)) &&
    (patch.settlementStatus === undefined ||
      ["confirmed", "provisional"].includes(patch.settlementStatus))
  );
}

function validateRequest(request: MoneyWriteRequest): void {
  if (
    request.schemaVersion !== "keiri.write.v1" ||
    !safeId(request.idempotencyKey)
  ) {
    throw new Error("invalid_write_request");
  }
  const action = request.action;
  if (action.type === "expense.update_metadata") {
    if (!safeId(action.expenseId) || !action.expectedUpdatedAt)
      throw new Error("invalid_expense_update");
    if (!isValidExpensePatch(action.patch)) {
      throw new Error("invalid_expense_patch");
    }
    return;
  }
  if (
    !/^\d{4}-(0[1-9]|1[0-2])$/.test(action.month) ||
    !safeId(action.commitmentId) ||
    !/^sha256:[a-f0-9]{64}$/.test(action.expectedPlanRevision) ||
    !["active", "cancellation_requested", "cancelled"].includes(action.status)
  ) {
    throw new Error("invalid_commitment_update");
  }
  if (
    action.status === "cancelled" &&
    (!action.evidence?.trim() || action.evidence.length > 500)
  ) {
    throw new Error("cancellation_evidence_required");
  }
}

export async function executeMoneyWrite(
  repositories: MoneyWriteRepositories,
  request: MoneyWriteRequest,
  executedAt: string = new Date().toISOString(),
): Promise<MoneyWriteResult> {
  validateRequest(request);
  const { action } = request;

  // 同じ idempotencyKey の再送は、実行済みの結果をそのまま返す。中身が違えば拒否する。
  const receiptKey = `agent_write_receipt:${request.idempotencyKey}`;
  const requestDigest = digest(action);
  const existing = await repositories.settings.get(receiptKey);
  if (existing) {
    const receipt = JSON.parse(existing) as {
      requestDigest?: string;
      result?: MoneyWriteResult;
    };
    if (receipt.requestDigest !== requestDigest || !receipt.result)
      throw new Error("idempotency_payload_mismatch");
    return receipt.result;
  }

  let result: MoneyWriteResult;
  if (action.type === "expense.update_metadata") {
    const current = await repositories.expenses.get(action.expenseId);
    if (!current) throw new Error("expense_not_found");
    // 呼び出し側が読んだ後に別の更新が入っていたら拒否する（楽観ロック）。
    if (current.updatedAt !== action.expectedUpdatedAt)
      throw new Error("stale_expense");
    const updated = await repositories.expenses.update(
      current.id,
      action.patch,
    );
    result = {
      type: action.type,
      id: updated.id,
      updatedAt: updated.updatedAt,
    };
  } else {
    const planKey = `money_plan:${action.month}`;
    const rawPlan = await repositories.settings.get(planKey);
    if (!rawPlan) throw new Error("money_plan_not_found");
    // 計画も同じく、読んだ時点の版と違えば拒否する。
    if (moneyPlanRevision(rawPlan) !== action.expectedPlanRevision)
      throw new Error("stale_money_plan");
    const plan = parseMoneyPlan(action.month, rawPlan);
    const index = plan.plannedCommitments.findIndex(
      (item) => item.id === action.commitmentId,
    );
    if (index < 0) throw new Error("commitment_not_found");
    const current = plan.plannedCommitments[index];
    const updatedCommitment = {
      ...current,
      status: action.status,
      cancellationEvidence:
        action.status === "cancelled" ? action.evidence?.trim() : undefined,
    };
    const updatedPlan: MoneyPlan = {
      ...plan,
      plannedCommitments: plan.plannedCommitments.map((item, itemIndex) =>
        itemIndex === index ? updatedCommitment : item,
      ),
    };
    await repositories.settings.set(planKey, JSON.stringify(updatedPlan));
    result = {
      type: action.type,
      id: current.id,
      month: action.month,
      status: action.status,
    };
  }

  await repositories.settings.set(
    receiptKey,
    JSON.stringify({
      requestDigest,
      result,
      executedAt,
      actor: "agent-api",
    }),
  );
  return result;
}
