import assert from "node:assert/strict";
import test from "node:test";
import type { Expense } from "./expense.ts";
import {
  calculateMoneySnapshot,
  formatPlannedCommitmentsText,
  parsePlannedCommitmentsText,
  parseMoneyPlan,
  type MoneyPlan,
} from "./money-coach.ts";

function expense(
  patch: Partial<Expense> & Pick<Expense, "id" | "date" | "amount">,
): Expense {
  return {
    merchant: "テスト加盟店",
    category: "要確認",
    source: "テスト",
    note: "",
    createdAt: "2026-07-20T00:00:00.000Z",
    updatedAt: "2026-07-20T00:00:00.000Z",
    ...patch,
  };
}

const plan: MoneyPlan = {
  month: "2026-07",
  targetAmount: 200_000,
  bufferAmount: 3_000,
  variableForecastAmount: 10_000,
  plannedCommitments: [
    { id: "rent", label: "家賃", amount: 45_000, responsibility: "self" },
    {
      id: "wifi",
      label: "SoftBank Air",
      amount: 5_000,
      responsibility: "other",
    },
  ],
};

test("対象引落月の本人負担だけで着地予測を計算する", () => {
  const snapshot = calculateMoneySnapshot(
    [
      expense({
        id: "confirmed",
        date: "2026-07-01",
        amount: 80_000,
        settlementStatus: "confirmed",
      }),
      expense({
        id: "pending",
        date: "2026-07-02",
        amount: 20_000,
        settlementStatus: "provisional",
      }),
      expense({
        id: "other",
        date: "2026-07-03",
        amount: 30_000,
        responsibility: "other",
      }),
      expense({
        id: "different-debit",
        date: "2026-07-04",
        amount: 50_000,
        expectedDebitMonth: "2026-08",
      }),
    ],
    plan,
    "2026-07-20T12:00:00.000Z",
  );

  assert.equal(snapshot.totals.confirmedAmount, 80_000);
  assert.equal(snapshot.totals.provisionalAmount, 20_000);
  assert.equal(snapshot.totals.plannedCommitmentsAmount, 45_000);
  assert.equal(snapshot.totals.forecastAmount, 158_000);
  assert.equal(snapshot.totals.safeToSpendAmount, 42_000);
  assert.equal(snapshot.excluded.otherResponsibilityCount, 2);
});

test("楽天速報は明示状態がなくても未確定として扱う", () => {
  const snapshot = calculateMoneySnapshot(
    [
      expense({
        id: "rakuten",
        date: "2026-07-10",
        amount: 12_345,
        source: "楽天速報",
        note: "確定版待ち",
      }),
    ],
    {
      ...plan,
      plannedCommitments: [],
      variableForecastAmount: 0,
      bufferAmount: 0,
    },
    "2026-07-20T12:00:00.000Z",
  );

  assert.equal(snapshot.totals.confirmedAmount, 0);
  assert.equal(snapshot.totals.provisionalAmount, 12_345);
  assert.equal(snapshot.confidence, "medium");
});

test("保存値が壊れているときは未設定プランへ安全にフォールバックする", () => {
  assert.deepEqual(parseMoneyPlan("2026-07", "not-json"), {
    month: "2026-07",
    targetAmount: null,
    bufferAmount: 0,
    variableForecastAmount: 0,
    plannedCommitments: [],
  });
});

test("スナップショットに店名・契約アカウント・生明細を含めない", () => {
  const snapshot = calculateMoneySnapshot(
    [
      expense({
        id: "private",
        date: "2026-07-10",
        amount: 1_000,
        merchant: "private@example.com",
      }),
    ],
    plan,
    "2026-07-20T12:00:00.000Z",
  );
  const serialized = JSON.stringify(snapshot);

  assert.equal(serialized.includes("private@example.com"), false);
  assert.equal(serialized.includes("private"), false);
});

test("固定費入力を名称・金額・負担者へ変換する", () => {
  assert.deepEqual(
    parsePlannedCommitmentsText("家賃,45000,self\nSoftBank Air,5000,other"),
    [
      {
        id: "commitment-1",
        label: "家賃",
        amount: 45_000,
        responsibility: "self",
      },
      {
        id: "commitment-2",
        label: "SoftBank Air",
        amount: 5_000,
        responsibility: "other",
      },
    ],
  );
  assert.throws(() => parsePlannedCommitmentsText("壊れた行"), /1行目/);
  assert.deepEqual(
    parsePlannedCommitmentsText("ChatGPT,3000,self,subscription,active"),
    [
      {
        id: "commitment-1",
        label: "ChatGPT",
        amount: 3_000,
        responsibility: "self",
        kind: "subscription",
        status: "active",
      },
    ],
  );
  assert.throws(
    () => parsePlannedCommitmentsText("Pairs,4100,self,subscription,cancelled"),
    /解約証跡/,
  );
  assert.equal(
    formatPlannedCommitmentsText([
      {
        id: "pairs",
        label: "Pairs",
        amount: 4_100,
        responsibility: "self",
        kind: "subscription",
        status: "cancelled",
        cancellationEvidence: "provider-confirmation",
      },
    ]),
    "Pairs,4100,self,subscription,cancelled,provider-confirmation",
  );
});

test("保存済み計画の不正な項目は捨て、許可されたサブスク状態だけを復元する", () => {
  assert.deepEqual(parseMoneyPlan("2026-07", "[]"), {
    month: "2026-07",
    targetAmount: null,
    bufferAmount: 0,
    variableForecastAmount: 0,
    plannedCommitments: [],
  });
  const restored = parseMoneyPlan(
    "2026-07",
    JSON.stringify({
      targetAmount: 200_000,
      plannedCommitments: [
        null,
        { id: 1, label: "invalid" },
        {
          id: "pairs",
          label: "Pairs",
          amount: 4_100,
          responsibility: "self",
          kind: "subscription",
          status: "cancellation_requested",
        },
      ],
    }),
  );
  assert.equal(restored.plannedCommitments.length, 1);
  assert.equal(restored.plannedCommitments[0].status, "cancellation_requested");
});

test("解約申請中は予測に残し、解約確認済みだけを予測から外す", () => {
  const snapshot = calculateMoneySnapshot([], {
    ...plan,
    bufferAmount: 0,
    variableForecastAmount: 0,
    plannedCommitments: [
      {
        id: "chatgpt",
        label: "ChatGPT",
        amount: 3_000,
        responsibility: "self",
        kind: "subscription",
        status: "cancellation_requested",
      },
      {
        id: "pairs",
        label: "Pairs",
        amount: 4_100,
        responsibility: "self",
        kind: "subscription",
        status: "cancelled",
        cancellationEvidence: "provider-confirmation-2026-07-20",
      },
    ],
  });

  assert.equal(snapshot.totals.plannedCommitmentsAmount, 3_000);
  assert.equal(snapshot.counts.plannedCommitments, 1);
  assert.equal(snapshot.excluded.cancelledCommitmentsCount, 1);
  assert.deepEqual(snapshot.actionCandidates, [
    {
      id: "chatgpt",
      label: "ChatGPT",
      amount: 3_000,
      status: "cancellation_requested",
    },
  ]);
});
