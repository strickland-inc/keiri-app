import type { Expense, ExpenseCategory } from "./expense";
import { normalizeMerchant } from "./reports.ts";
import { toIsoDate } from "./dates.ts";

export type ExpenseSearchPeriod = "last3" | "year" | "all" | `month:${string}`;
/** review は費目が「要確認」、pending は速報など金額が確定していない明細。 */
export type ExpenseSearchStatus = "all" | "review" | "pending";

export interface ExpenseSearchFilters {
  query: string;
  period: ExpenseSearchPeriod;
  category: ExpenseCategory | "";
  status: ExpenseSearchStatus;
  source: string;
  minAmount: number | null;
  maxAmount: number | null;
}

/** ひらがなをカタカナにそろえ、読みの違いで検索を外さないようにする。 */
function katakanaCanonical(value: string): string {
  return value.replace(/[\u3041-\u3096]/g, (character) =>
    String.fromCharCode(character.charCodeAt(0) + 0x60),
  );
}

/** 全角半角・大文字小文字・空白・ひらがなカタカナの違いを吸収した検索用の文字列にする。 */
export function normalizeExpenseSearchText(value: string): string {
  return katakanaCanonical(
    value
      .normalize("NFKC")
      .toLocaleLowerCase("ja-JP")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

export function isExpenseSearchPeriod(
  value: string,
): value is ExpenseSearchPeriod {
  return (
    value === "last3" ||
    value === "year" ||
    value === "all" ||
    /^month:\d{4}-(0[1-9]|1[0-2])$/.test(value)
  );
}

export function isExpenseSearchStatus(
  value: string,
): value is ExpenseSearchStatus {
  return value === "all" || value === "review" || value === "pending";
}

function normalizeSearchToken(value: string): string {
  return normalizeExpenseSearchText(value).replace(/[,¥￥円]/g, "");
}

function searchTokens(query: string): string[] {
  return normalizeExpenseSearchText(query)
    .split(" ")
    .map(normalizeSearchToken)
    .filter(Boolean);
}

/** 検索対象の項目をつないだ文字列。金額の区切りや円記号は検索語側と同じく落とす。 */
function searchableText(expense: Expense): string {
  return [
    expense.merchant,
    normalizeMerchant(expense.merchant),
    expense.category,
    expense.source,
    expense.note,
    expense.date,
    String(expense.amount),
  ]
    .map(normalizeExpenseSearchText)
    .join(" ")
    .replace(/[,¥￥円]/g, "");
}

function isInPeriod(
  date: string,
  period: ExpenseSearchPeriod,
  today: Date,
): boolean {
  if (period === "all") return true;

  if (period.startsWith("month:")) {
    return date.startsWith(period.slice("month:".length));
  }

  const to = toIsoDate(today);
  if (period === "year") {
    return date >= `${today.getFullYear()}-01-01` && date <= to;
  }

  // last3: 当月を含む3か月分（2か月前の1日から今日まで）。
  const fromDate = new Date(today.getFullYear(), today.getMonth() - 2, 1);
  return date >= toIsoDate(fromDate) && date <= to;
}

function matchesStatus(expense: Expense, status: ExpenseSearchStatus): boolean {
  if (status === "all") return true;
  if (status === "review") return expense.category === "要確認";
  return expense.source === "楽天速報" || expense.note.includes("確定版待ち");
}

/** 条件をすべて満たす経費に絞る。検索語は空白区切りで、全語を含むものだけ残す。 */
export function filterExpenses(
  expenses: readonly Expense[],
  filters: ExpenseSearchFilters,
  today = new Date(),
): Expense[] {
  const tokens = searchTokens(filters.query);

  return expenses.filter((expense) => {
    if (!isInPeriod(expense.date, filters.period, today)) return false;
    if (filters.category && expense.category !== filters.category) return false;
    if (filters.source && expense.source !== filters.source) return false;
    if (filters.minAmount !== null && expense.amount < filters.minAmount)
      return false;
    if (filters.maxAmount !== null && expense.amount > filters.maxAmount)
      return false;
    if (!matchesStatus(expense, filters.status)) return false;

    if (tokens.length === 0) return true;
    const haystack = searchableText(expense);
    return tokens.every((token) => haystack.includes(token));
  });
}

export function expensePeriodLabel(
  period: ExpenseSearchPeriod,
  today = new Date(),
): string {
  if (period === "all") return "全期間";
  if (period === "last3") return "過去3か月";
  if (period === "year") return `${today.getFullYear()}年`;

  const [year, month] = period.slice("month:".length).split("-");
  return `${year}年${Number(month)}月`;
}

export function hasActiveExpenseSearch(
  filters: ExpenseSearchFilters,
  currentMonth: string,
): boolean {
  return Boolean(
    filters.query ||
    filters.period !== `month:${currentMonth}` ||
    filters.category ||
    filters.status !== "all" ||
    filters.source ||
    filters.minAmount !== null ||
    filters.maxAmount !== null,
  );
}
