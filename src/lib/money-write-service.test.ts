import assert from "node:assert/strict";
import test from "node:test";
import type { Expense } from "../domain/expense.ts";
import type {
  ExpenseRepository,
  SettingsRepository,
} from "../repositories/types.ts";
import {
  executeMoneyWrite,
  moneyPlanRevision,
  type MoneyWriteRepositories,
} from "./money-write-service.ts";

function repositories(): {
  repos: MoneyWriteRepositories;
  expense: Expense;
  settingsValues: Map<string, string>;
} {
  let expense: Expense = {
    id: "expense-1",
    date: "2026-07-02",
    merchant: "非公開加盟店",
    amount: 10_000,
    category: "要確認",
    source: "test",
    note: "",
    createdAt: "2026-07-02T00:00:00.000Z",
    updatedAt: "2026-07-20T00:00:00.000Z",
  };
  const expenses: ExpenseRepository = {
    async list() {
      return [expense];
    },
    async get(id) {
      return id === expense.id ? expense : null;
    },
    async create() {
      throw new Error("not used");
    },
    async bulkCreate() {
      throw new Error("not used");
    },
    async update(id, patch) {
      expense = {
        ...expense,
        ...patch,
        id,
        updatedAt: "2026-07-20T01:00:00.000Z",
      };
      return expense;
    },
    async remove() {
      throw new Error("not used");
    },
  };
  const plan = {
    month: "2026-07",
    targetAmount: 200_000,
    bufferAmount: 5_000,
    variableForecastAmount: 10_000,
    plannedCommitments: [
      {
        id: "pairs",
        label: "Pairs",
        amount: 4_100,
        responsibility: "self",
        kind: "subscription",
        status: "active",
      },
    ],
  };
  const settingsValues = new Map<string, string>([
    ["money_plan:2026-07", JSON.stringify(plan)],
  ]);
  const settings: SettingsRepository = {
    async get(key) {
      return settingsValues.get(key) ?? null;
    },
    async set(key, value) {
      settingsValues.set(key, value);
    },
    async all() {
      return Object.fromEntries(settingsValues);
    },
  };
  return { repos: { expenses, settings }, expense, settingsValues };
}

test("承認済みの操作は対象時刻が一致するときだけ経費メタデータを更新する", async () => {
  const fixture = repositories();
  const result = await executeMoneyWrite(
    fixture.repos,
    {
      schemaVersion: "keiri.write.v1",
      idempotencyKey: "apr_expense_update_1",
      action: {
        type: "expense.update_metadata",
        expenseId: fixture.expense.id,
        expectedUpdatedAt: fixture.expense.updatedAt,
        patch: { responsibility: "other", expectedDebitMonth: "2026-08" },
      },
    },
    "2026-07-20T02:00:00.000Z",
  );

  assert.deepEqual(result, {
    type: "expense.update_metadata",
    id: "expense-1",
    updatedAt: "2026-07-20T01:00:00.000Z",
  });
  assert.equal(
    (await fixture.repos.expenses.get("expense-1"))?.responsibility,
    "other",
  );
  assert.ok(
    fixture.settingsValues.has("agent_write_receipt:apr_expense_update_1"),
  );
});

test("古い経費時刻での更新は拒否し、再実行でも書き換えない", async () => {
  const fixture = repositories();
  await assert.rejects(
    () =>
      executeMoneyWrite(fixture.repos, {
        schemaVersion: "keiri.write.v1",
        idempotencyKey: "apr_stale_expense_1",
        action: {
          type: "expense.update_metadata",
          expenseId: fixture.expense.id,
          expectedUpdatedAt: "2026-07-19T00:00:00.000Z",
          patch: { responsibility: "other" },
        },
      }),
    /stale_expense/,
  );
  assert.equal(
    (await fixture.repos.expenses.get("expense-1"))?.responsibility,
    undefined,
  );
});

test("解約確認は計画revision一致と証跡を必須にし、同一キーは冪等に返す", async () => {
  const fixture = repositories();
  const rawPlan = fixture.settingsValues.get("money_plan:2026-07")!;
  const request = {
    schemaVersion: "keiri.write.v1" as const,
    idempotencyKey: "apr_cancel_pairs_1",
    action: {
      type: "commitment.update_status" as const,
      month: "2026-07",
      commitmentId: "pairs",
      expectedPlanRevision: moneyPlanRevision(rawPlan),
      status: "cancelled" as const,
      evidence: "provider-confirmation-2026-07-20",
    },
  };

  const first = await executeMoneyWrite(
    fixture.repos,
    request,
    "2026-07-20T02:00:00.000Z",
  );
  const second = await executeMoneyWrite(
    fixture.repos,
    request,
    "2026-07-20T03:00:00.000Z",
  );
  assert.deepEqual(second, first);
  assert.equal(
    JSON.parse(fixture.settingsValues.get("money_plan:2026-07")!)
      .plannedCommitments[0].status,
    "cancelled",
  );

  const noEvidence = {
    ...request,
    idempotencyKey: "apr_cancel_pairs_2",
    action: { ...request.action, evidence: "" },
  };
  await assert.rejects(
    () => executeMoneyWrite(fixture.repos, noEvidence),
    /cancellation_evidence_required/,
  );
});

test("許可外の書き込み形式と古いplan revisionを拒否する", async () => {
  const fixture = repositories();
  const invalidSchema = {
    schemaVersion: "keiri.write.v0",
    idempotencyKey: "invalid_schema_1",
    action: {
      type: "expense.update_metadata",
      expenseId: "expense-1",
      expectedUpdatedAt: fixture.expense.updatedAt,
      patch: { responsibility: "other" },
    },
  } as unknown as import("./money-write-service.ts").MoneyWriteRequest;
  await assert.rejects(
    () => executeMoneyWrite(fixture.repos, invalidSchema),
    /invalid_write_request/,
  );

  const emptyPatch = {
    schemaVersion: "keiri.write.v1",
    idempotencyKey: "invalid_patch_1",
    action: {
      type: "expense.update_metadata",
      expenseId: "expense-1",
      expectedUpdatedAt: fixture.expense.updatedAt,
      patch: {},
    },
  } as import("./money-write-service.ts").MoneyWriteRequest;
  await assert.rejects(
    () => executeMoneyWrite(fixture.repos, emptyPatch),
    /invalid_expense_patch/,
  );

  await assert.rejects(
    () =>
      executeMoneyWrite(fixture.repos, {
        schemaVersion: "keiri.write.v1",
        idempotencyKey: "stale_plan_1",
        action: {
          type: "commitment.update_status",
          month: "2026-07",
          commitmentId: "pairs",
          expectedPlanRevision: "sha256:" + "a".repeat(64),
          status: "cancellation_requested",
        },
      }),
    /stale_money_plan/,
  );
});
