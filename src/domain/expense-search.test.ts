import assert from "node:assert/strict";
import test from "node:test";
import type { Expense } from "./expense";
import {
  expensePeriodLabel,
  filterExpenses,
  hasActiveExpenseSearch,
  isExpenseSearchPeriod,
  isExpenseSearchStatus,
  normalizeExpenseSearchText,
  type ExpenseSearchFilters,
} from "./expense-search.ts";

const expenses: readonly Expense[] = [
  {
    id: "amazon",
    date: "2026-07-13",
    merchant: "ＶＩＳＡ国内利用　VS ｱﾏｿﾞﾝ",
    amount: 1033,
    category: "通信費",
    source: "楽天メール",
    note: "クラウド利用料",
    createdAt: "2026-07-14T00:00:00.000Z",
    updatedAt: "2026-07-14T00:00:00.000Z",
  },
  {
    id: "pending",
    date: "2026-07-15",
    merchant: "利用先未確定（楽天速報）",
    amount: 19720,
    category: "要確認",
    source: "楽天速報",
    note: "確定版待ち",
    createdAt: "2026-07-16T00:00:00.000Z",
    updatedAt: "2026-07-16T00:00:00.000Z",
  },
  {
    id: "june",
    date: "2026-06-20",
    merchant: "スターバックス",
    amount: 680,
    category: "会議費",
    source: "楽天メール",
    note: "顧客打ち合わせ",
    createdAt: "2026-06-21T00:00:00.000Z",
    updatedAt: "2026-06-21T00:00:00.000Z",
  },
  {
    id: "april",
    date: "2026-04-02",
    merchant: "Adobe",
    amount: 3280,
    category: "通信費",
    source: "領収書スキャン",
    note: "",
    createdAt: "2026-04-02T00:00:00.000Z",
    updatedAt: "2026-04-02T00:00:00.000Z",
  },
  {
    id: "last-year",
    date: "2025-12-15",
    merchant: "GitHub",
    amount: 1500,
    category: "通信費",
    source: "楽天メール",
    note: "",
    createdAt: "2025-12-16T00:00:00.000Z",
    updatedAt: "2025-12-16T00:00:00.000Z",
  },
];

const today = new Date("2026-07-18T12:00:00+09:00");

function filters(patch: Partial<ExpenseSearchFilters>): ExpenseSearchFilters {
  return {
    query: "",
    period: "all",
    category: "",
    status: "all",
    source: "",
    minAmount: null,
    maxAmount: null,
    ...patch,
  };
}

test("全角・半角、英字大小、余分な空白を正規化する", () => {
  assert.equal(
    normalizeExpenseSearchText("  Ａｍａｚｏｎ　ｱﾏｿﾞﾝ  "),
    "amazon アマゾン",
  );
});

test("ひらがな・カタカナの表記揺れを吸収する", () => {
  const result = filterExpenses(
    expenses,
    filters({ query: "すたーばっくす" }),
    today,
  );

  assert.deepEqual(
    result.map((expense) => expense.id),
    ["june"],
  );
});

test("表記揺れした店名とカンマ付き金額を複数語ANDで検索する", () => {
  const result = filterExpenses(
    expenses,
    filters({ query: "アマゾン 1,033" }),
    today,
  );

  assert.deepEqual(
    result.map((expense) => expense.id),
    ["amazon"],
  );
});

test("費目・ソース・メモもフリーワード検索対象にする", () => {
  const result = filterExpenses(
    expenses,
    filters({ query: "会議費 顧客" }),
    today,
  );

  assert.deepEqual(
    result.map((expense) => expense.id),
    ["june"],
  );
});

test("確定待ちだけを絞り込む", () => {
  const result = filterExpenses(
    expenses,
    filters({ status: "pending" }),
    today,
  );

  assert.deepEqual(
    result.map((expense) => expense.id),
    ["pending"],
  );
});

test("要確認には確定待ちを含む", () => {
  const result = filterExpenses(expenses, filters({ status: "review" }), today);

  assert.deepEqual(
    result.map((expense) => expense.id),
    ["pending"],
  );
});

test("期間プリセットと指定月で絞り込む", () => {
  assert.deepEqual(
    filterExpenses(expenses, filters({ period: "last3" }), today).map(
      (expense) => expense.id,
    ),
    ["amazon", "pending", "june"],
  );
  assert.deepEqual(
    filterExpenses(expenses, filters({ period: "year" }), today).map(
      (expense) => expense.id,
    ),
    ["amazon", "pending", "june", "april"],
  );
  assert.deepEqual(
    filterExpenses(expenses, filters({ period: "month:2026-06" }), today).map(
      (expense) => expense.id,
    ),
    ["june"],
  );
});

test("費目とソースを組み合わせて絞り込む", () => {
  const result = filterExpenses(
    expenses,
    filters({ category: "通信費", source: "楽天メール" }),
    today,
  );

  assert.deepEqual(
    result.map((expense) => expense.id),
    ["amazon", "last-year"],
  );
});

test("金額の下限・上限は片方だけでも組み合わせても絞り込める", () => {
  assert.deepEqual(
    filterExpenses(
      expenses,
      filters({ minAmount: 1000, maxAmount: 4000 }),
      today,
    ).map((expense) => expense.id),
    ["amazon", "april", "last-year"],
  );
  assert.deepEqual(
    filterExpenses(expenses, filters({ minAmount: 3000 }), today).map(
      (expense) => expense.id,
    ),
    ["pending", "april"],
  );
  assert.deepEqual(
    filterExpenses(expenses, filters({ maxAmount: 1000 }), today).map(
      (expense) => expense.id,
    ),
    ["june"],
  );
});

test("期間・状態のURL値を検証し、表示ラベルと検索中判定を返す", () => {
  assert.equal(isExpenseSearchPeriod("month:2026-07"), true);
  assert.equal(isExpenseSearchPeriod("month:2026-13"), false);
  assert.equal(isExpenseSearchStatus("pending"), true);
  assert.equal(isExpenseSearchStatus("done"), false);
  assert.equal(expensePeriodLabel("all", today), "全期間");
  assert.equal(expensePeriodLabel("last3", today), "過去3か月");
  assert.equal(expensePeriodLabel("year", today), "2026年");
  assert.equal(expensePeriodLabel("month:2026-06", today), "2026年6月");
  assert.equal(
    hasActiveExpenseSearch(filters({ period: "month:2026-07" }), "2026-07"),
    false,
  );
  assert.equal(
    hasActiveExpenseSearch(
      filters({ period: "month:2026-07", minAmount: 1000 }),
      "2026-07",
    ),
    true,
  );
});
