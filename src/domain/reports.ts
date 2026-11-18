/** 経費の期間集計と利用先ランキング。日付は YYYY-MM-DD の文字列で比べる。 */
import type { Expense, ExpenseCategory } from "./expense";
import { toIsoDate } from "./dates.ts";

/** 両端を含む期間。 */
export interface DateRange {
  from: string;
  to: string;
}

// カード明細の利用先に付く、店名ではない先頭の定型文（全角表記のまま照合する）。
const CARD_PREFIXES: readonly string[] = [
  "ＶＩＳＡ国内利用　VS ",
  "ＪＣＢ国内利用　QP ",
  "ＶＩＳＡ海外利用　",
];

/**
 * 利用先の表記ゆれを名寄せする。カード会社の定型文、末尾の利用国・数字を落とし、
 * 空白を半角1つにそろえる。落とした結果が空なら元の文字列を返す。
 */
export function normalizeMerchant(raw: string): string {
  let s = raw;

  for (const prefix of CARD_PREFIXES) {
    if (s.startsWith(prefix)) {
      s = s.slice(prefix.length);
      break;
    }
  }

  s = s.replace(/利用国[A-Z]{2}$/, "");
  s = s.replace(/[\d\s]+$/, "");
  s = s.replace(/　/g, " ");
  s = s.replace(/\s+/g, " ");
  s = s.trim();

  return s === "" ? raw : s;
}

export function inRange(date: string, range: DateRange): boolean {
  return date >= range.from && date <= range.to;
}

export interface MerchantRankItem {
  merchant: string;
  count: number;
  total: number;
  topCategory: ExpenseCategory;
}

/** 利用先ごとの集計途中の値。catCount は最頻の費目を選ぶために持つ。 */
interface EntryData {
  count: number;
  total: number;
  catCount: Map<ExpenseCategory, number>;
}

interface MerchantRankingOptions {
  expenses: readonly Expense[];
  range: DateRange;
  limit?: number;
}

export interface MerchantRankingResult {
  byCount: MerchantRankItem[];
  byAmount: MerchantRankItem[];
}

export function merchantRanking({
  expenses,
  range,
  limit = 15,
}: MerchantRankingOptions): MerchantRankingResult {
  const filtered = expenses.filter((e) => inRange(e.date, range));
  const map = new Map<string, EntryData>();

  for (const e of filtered) {
    const key = normalizeMerchant(e.merchant);
    const entry = map.get(key) ?? {
      count: 0,
      total: 0,
      catCount: new Map<ExpenseCategory, number>(),
    };
    entry.count += 1;
    entry.total += e.amount;
    entry.catCount.set(e.category, (entry.catCount.get(e.category) ?? 0) + 1);
    map.set(key, entry);
  }

  const toItem = (merchant: string, data: EntryData): MerchantRankItem => {
    const sorted = [...data.catCount.entries()].sort((a, b) => b[1] - a[1]);
    const topCategory: ExpenseCategory = sorted[0]?.[0] ?? "雑費";
    return {
      merchant,
      count: data.count,
      total: data.total,
      topCategory,
    };
  };

  const items = [...map.entries()].map(([m, d]) => toItem(m, d));

  // 件数順と金額順で、同点のときは互いを副キーにする。
  const byCount = [...items]
    .sort((a, b) => b.count - a.count || b.total - a.total)
    .slice(0, limit);
  const byAmount = [...items]
    .sort((a, b) => b.total - a.total || b.count - a.count)
    .slice(0, limit);

  return { byCount, byAmount };
}

export interface PeriodSummary {
  total: number;
  count: number;
}

export function periodSummary(
  expenses: readonly Expense[],
  range: DateRange,
): PeriodSummary {
  const filtered = expenses.filter((e) => inRange(e.date, range));
  const total = filtered.reduce((sum, e) => sum + e.amount, 0);
  return {
    total,
    count: filtered.length,
  };
}

// 週は月曜始まり。日曜(0)は6日前の月曜に属する。
/** 今週の月曜から today まで。 */
export function thisWeekRange(today: Date): DateRange {
  const dow = today.getDay();
  const offset = dow === 0 ? -6 : 1 - dow;
  const monday = new Date(today);
  monday.setDate(today.getDate() + offset);
  return { from: toIsoDate(monday), to: toIsoDate(today) };
}

/** 先週の月曜から日曜まで。 */
export function lastWeekRange(today: Date): DateRange {
  const dow = today.getDay();
  const offset = dow === 0 ? -6 : 1 - dow;
  const thisMonday = new Date(today);
  thisMonday.setDate(today.getDate() + offset);
  const lastMonday = new Date(thisMonday);
  lastMonday.setDate(thisMonday.getDate() - 7);
  const lastSunday = new Date(thisMonday);
  lastSunday.setDate(thisMonday.getDate() - 1);
  return { from: toIsoDate(lastMonday), to: toIsoDate(lastSunday) };
}

/** 今月1日から月末まで。 */
export function thisMonthRange(today: Date): DateRange {
  const from = new Date(today.getFullYear(), today.getMonth(), 1);
  const to = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  return { from: toIsoDate(from), to: toIsoDate(to) };
}

/** 先月1日から月末まで。 */
export function lastMonthRange(today: Date): DateRange {
  const from = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const to = new Date(today.getFullYear(), today.getMonth(), 0);
  return { from: toIsoDate(from), to: toIsoDate(to) };
}

/** 前期比の増減率（%）。比べる相手が 0 のときは求められないので null。 */
export function changeRate(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return ((current - previous) / previous) * 100;
}
