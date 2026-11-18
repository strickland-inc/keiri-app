/**
 * お金コーチ。今月の「使っていい金額」を、確定済みの支出・速報（金額未確定）の支出・
 * 固定費・変動費の見込み・予備費から求める。
 * 経費は会社の帳簿ではなく本人のお金として、会社をまたいで集計する。
 */
import type { Expense } from "./expense";

/** 毎月決まって出ていく支出（固定費・サブスク）の計画。 */
export interface PlannedCommitment {
  id: string;
  label: string;
  amount: number;
  responsibility: "self" | "other";
  kind?: "fixed" | "subscription" | "other";
  status?: "active" | "cancellation_requested" | "cancelled";
  cancellationEvidence?: string;
}

/** 月ごとの家計計画。month は YYYY-MM。 */
export interface MoneyPlan {
  month: string;
  targetAmount: number | null;
  bufferAmount: number;
  variableForecastAmount: number;
  plannedCommitments: PlannedCommitment[];
}

/** 計画と経費から計算した月の見通し。schemaVersion を持ち、外部へそのまま返せる形。 */
export interface MoneySnapshot {
  schemaVersion: "keiri.money_snapshot.v1";
  month: string;
  asOf: string;
  planRevision?: string;
  configured: boolean;
  confidence: "high" | "medium" | "low";
  goal: {
    targetAmount: number | null;
    bufferAmount: number;
  };
  totals: {
    confirmedAmount: number;
    provisionalAmount: number;
    plannedCommitmentsAmount: number;
    variableForecastAmount: number;
    forecastAmount: number;
    safeToSpendAmount: number | null;
  };
  counts: {
    confirmed: number;
    provisional: number;
    plannedCommitments: number;
  };
  excluded: {
    otherResponsibilityCount: number;
    outsideDebitMonthCount: number;
    cancelledCommitmentsCount: number;
  };
  actionCandidates: Array<{
    id: string;
    label: string;
    amount: number;
    status: "active" | "cancellation_requested";
  }>;
}

function nonNegativeAmount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.trunc(value)
    : 0;
}

function isMonth(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

export function emptyMoneyPlan(month: string): MoneyPlan {
  return {
    month,
    targetAmount: null,
    bufferAmount: 0,
    variableForecastAmount: 0,
    plannedCommitments: [],
  };
}

/**
 * 固定費の入力テキストを読む。1行1件で、カンマ区切り。
 * `名称,金額,負担者,種別,状態,解約証跡`（名称と金額以外は省略可）。
 * 不正な行は何行目かを添えて例外にする。
 */
export function parsePlannedCommitmentsText(text: string): PlannedCommitment[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const [
        labelRaw,
        amountRaw,
        responsibilityRaw = "self",
        kindRaw,
        statusRaw,
        evidenceRaw,
        ...extra
      ] = line.split(",").map((part) => part.trim());
      const amount = Number(amountRaw);
      const kind = kindRaw || undefined;
      const status = statusRaw || undefined;
      if (
        !labelRaw ||
        !Number.isFinite(amount) ||
        amount < 0 ||
        extra.length > 0 ||
        !["self", "other"].includes(responsibilityRaw) ||
        (kind !== undefined &&
          !["fixed", "subscription", "other"].includes(kind)) ||
        (status !== undefined &&
          !["active", "cancellation_requested", "cancelled"].includes(status))
      ) {
        throw new Error(`${index + 1}行目の固定費形式が不正です`);
      }
      if (status === "cancelled" && !evidenceRaw) {
        throw new Error(`${index + 1}行目の解約済み項目には解約証跡が必要です`);
      }
      const item: PlannedCommitment = {
        id: `commitment-${index + 1}`,
        label: labelRaw,
        amount: Math.trunc(amount),
        responsibility: responsibilityRaw as "self" | "other",
      };
      if (kind !== undefined) item.kind = kind as PlannedCommitment["kind"];
      if (status !== undefined)
        item.status = status as PlannedCommitment["status"];
      if (evidenceRaw) item.cancellationEvidence = evidenceRaw;
      return item;
    });
}

/** parsePlannedCommitmentsText の逆変換。末尾の空欄は省く。 */
export function formatPlannedCommitmentsText(
  items: readonly PlannedCommitment[],
): string {
  return items
    .map((item) => {
      if (!item.kind && !item.status && !item.cancellationEvidence) {
        return `${item.label},${item.amount},${item.responsibility}`;
      }
      return [
        item.label,
        item.amount,
        item.responsibility,
        item.kind ?? "fixed",
        item.status ?? "active",
        item.cancellationEvidence ?? "",
      ]
        .join(",")
        .replace(/,+$/, "");
    })
    .join("\n");
}

/** 保存済み JSON の1件を固定費として読む。id と label が無ければ捨てる。 */
function parseStoredCommitment(candidate: unknown): PlannedCommitment[] {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return [];
  }
  const item = candidate as Record<string, unknown>;
  if (typeof item.id !== "string" || typeof item.label !== "string") return [];

  return [
    {
      id: item.id,
      label: item.label,
      amount: nonNegativeAmount(item.amount),
      responsibility: item.responsibility === "other" ? "other" : "self",
      kind:
        item.kind === "subscription" || item.kind === "other"
          ? item.kind
          : "fixed",
      status:
        item.status === "cancellation_requested" || item.status === "cancelled"
          ? item.status
          : "active",
      cancellationEvidence:
        typeof item.cancellationEvidence === "string"
          ? item.cancellationEvidence
          : undefined,
    },
  ];
}

/** 設定に保存した JSON を計画に戻す。壊れた値は空の計画か 0 円に倒す。 */
export function parseMoneyPlan(month: string, raw: string | null): MoneyPlan {
  if (!isMonth(month) || !raw) return emptyMoneyPlan(month);
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return emptyMoneyPlan(month);
    }
    const input = value as Record<string, unknown>;
    const commitments = Array.isArray(input.plannedCommitments)
      ? input.plannedCommitments.flatMap(parseStoredCommitment)
      : [];
    return {
      month,
      targetAmount:
        typeof input.targetAmount === "number" &&
        Number.isFinite(input.targetAmount)
          ? nonNegativeAmount(input.targetAmount)
          : null,
      bufferAmount: nonNegativeAmount(input.bufferAmount),
      variableForecastAmount: nonNegativeAmount(input.variableForecastAmount),
      plannedCommitments: commitments,
    };
  } catch {
    return emptyMoneyPlan(month);
  }
}

/** 金額が未確定の速報明細か。状態が無い古いデータは、摘要や備考の文言で判定する。 */
function isProvisional(expense: Expense): boolean {
  if (expense.settlementStatus)
    return expense.settlementStatus === "provisional";
  return expense.source.includes("速報") || expense.note.includes("確定版待ち");
}

/**
 * 計画の対象月に引き落とされる、本人負担の支出だけを集計する。
 * 他人負担と対象月外の経費、他人負担・解約済みの固定費は、数えずに excluded へ件数だけ残す。
 */
export function calculateMoneySnapshot(
  expenses: readonly Expense[],
  plan: MoneyPlan,
  asOf: string = new Date().toISOString(),
): MoneySnapshot {
  let confirmedAmount = 0;
  let provisionalAmount = 0;
  let confirmed = 0;
  let provisional = 0;
  let otherResponsibilityCount = 0;
  let outsideDebitMonthCount = 0;
  let cancelledCommitmentsCount = 0;

  for (const expense of expenses) {
    if (expense.responsibility === "other") {
      otherResponsibilityCount += 1;
      continue;
    }
    const debitMonth = expense.expectedDebitMonth ?? expense.date.slice(0, 7);
    if (debitMonth !== plan.month) {
      outsideDebitMonthCount += 1;
      continue;
    }
    if (isProvisional(expense)) {
      provisionalAmount += nonNegativeAmount(expense.amount);
      provisional += 1;
    } else {
      confirmedAmount += nonNegativeAmount(expense.amount);
      confirmed += 1;
    }
  }

  const selfCommitments = plan.plannedCommitments.filter((item) => {
    if (item.responsibility === "other") {
      otherResponsibilityCount += 1;
      return false;
    }
    if (item.status === "cancelled") {
      cancelledCommitmentsCount += 1;
      return false;
    }
    return true;
  });
  const plannedCommitmentsAmount = selfCommitments.reduce(
    (sum, item) => sum + nonNegativeAmount(item.amount),
    0,
  );
  const forecastAmount =
    confirmedAmount +
    provisionalAmount +
    plannedCommitmentsAmount +
    plan.variableForecastAmount +
    plan.bufferAmount;

  // 目標が未設定なら信頼度は低い。速報が混ざっていれば確定額ではないので中にする。
  const confidence =
    plan.targetAmount === null ? "low" : provisional > 0 ? "medium" : "high";

  return {
    schemaVersion: "keiri.money_snapshot.v1",
    month: plan.month,
    asOf,
    configured: plan.targetAmount !== null,
    confidence,
    goal: {
      targetAmount: plan.targetAmount,
      bufferAmount: plan.bufferAmount,
    },
    totals: {
      confirmedAmount,
      provisionalAmount,
      plannedCommitmentsAmount,
      variableForecastAmount: plan.variableForecastAmount,
      forecastAmount,
      safeToSpendAmount:
        plan.targetAmount === null ? null : plan.targetAmount - forecastAmount,
    },
    counts: {
      confirmed,
      provisional,
      plannedCommitments: selfCommitments.length,
    },
    excluded: {
      otherResponsibilityCount,
      outsideDebitMonthCount,
      cancelledCommitmentsCount,
    },
    actionCandidates: selfCommitments
      .filter((item) => item.kind === "subscription")
      .map((item) => ({
        id: item.id,
        label: item.label,
        amount: nonNegativeAmount(item.amount),
        status:
          item.status === "cancellation_requested"
            ? "cancellation_requested"
            : "active",
      })),
  };
}
