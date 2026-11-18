/**
 * ダッシュボード用の純関数群。外部依存なし。
 * 「一人会社のお金＝自分のお金」前提で、事業と私用を区別せず合算する。
 *
 * 会計仮定:
 * - income: type="invoice" かつ status=issued/sent/paid の請求書の税込合計
 * - expense: すべての経費（区分なし）
 * - 月は YYYY-MM 形式（"2026-06" 等）
 */
import type { Expense } from "./expense";
import type { DocumentRecord } from "./documents";
import { summarize } from "./money";
import { toIsoDate } from "./dates.ts";

/** 請求済みとして売上に数える状態。下書きと無効は含めない。 */
function isBilledInvoice(doc: DocumentRecord): boolean {
  return (
    doc.type === "invoice" &&
    (doc.status === "issued" || doc.status === "sent" || doc.status === "paid")
  );
}

export interface MonthlyPoint {
  month: string;
  income: number;
  expense: number;
  net: number;
}

export interface Alert {
  level: "info" | "warn" | "alert";
  title: string;
  detail: string;
}

export interface RunwayResult {
  monthlyNet: number;
  months: number | null;
  status: "burning" | "growing" | "flat";
}

export interface TaxEstimateResult {
  ytdBusinessRevenue: number;
  ytdBusinessExpense: number;
  ytdProfit: number;
  annualizedProfit: number;
  estimatedTax: number;
  disclaimer: string;
}

/**
 * 各月の収支ポイントを計算する。
 * - income: 請求書（issued/sent/paid）の発行月ベースの税込合計
 * - expense: 区分なしの全経費の合計
 */
export function monthlySeries(
  expenses: readonly Expense[],
  invoices: readonly DocumentRecord[],
  months: string[],
): MonthlyPoint[] {
  return months.map((month) => {
    const income = invoices
      .filter((inv) => isBilledInvoice(inv) && inv.issueDate.startsWith(month))
      .reduce((sum, inv) => sum + summarize(inv.items).total, 0);

    const expense = expenses
      .filter((e) => e.date.startsWith(month))
      .reduce((sum, e) => sum + e.amount, 0);

    return { month, income, expense, net: income - expense };
  });
}

/**
 * 使いすぎアラートを生成する。
 * - series: 月次ポイントの配列（最後の要素が当月）
 * - expenses: 分析期間内の全経費（費目別の前月比較に使用）
 *
 * アラート基準:
 * - 当月支出が直近3ヶ月平均の120%以上 → warn
 * - 当月支出が直近3ヶ月平均の150%以上 → alert
 * - 費目別に当月が1万円超で、前3ヶ月平均の2倍以上 → warn
 */
export function overspendAlerts(
  series: readonly MonthlyPoint[],
  expenses: readonly Expense[],
): Alert[] {
  if (series.length === 0) return [];

  const current = series[series.length - 1];
  const prev3 = series.slice(Math.max(0, series.length - 4), series.length - 1);
  const alerts: Alert[] = [];

  // 前3ヶ月（当月を除く）。
  if (prev3.length > 0) {
    const avgExpense =
      prev3.reduce((sum, m) => sum + m.expense, 0) / prev3.length;

    if (avgExpense > 0) {
      const ratio = current.expense / avgExpense;
      const detail = `直近3ヶ月平均の${Math.round(ratio * 100)}%（今月${current.expense.toLocaleString("ja-JP")}円 / 平均${Math.round(avgExpense).toLocaleString("ja-JP")}円）`;
      if (ratio >= 1.5) {
        alerts.push({
          level: "alert",
          title: "今月の支出が急増しています",
          detail,
        });
      } else if (ratio >= 1.2) {
        alerts.push({
          level: "warn",
          title: "今月の支出が増加傾向です",
          detail,
        });
      }
    }
  }

  // 費目別アラート
  const currentMonth = current.month;
  const prev3Months = prev3.map((m) => m.month);

  if (prev3Months.length > 0) {
    // 当月費目別合計
    const currentByCategory = new Map<string, number>();
    for (const e of expenses) {
      if (e.date.startsWith(currentMonth)) {
        currentByCategory.set(
          e.category,
          (currentByCategory.get(e.category) ?? 0) + e.amount,
        );
      }
    }

    // 前3ヶ月の月別・費目別合計。費目の月平均を出すために使う
    const prevMonthlyByCategory = new Map<string, Map<string, number>>();
    for (const month of prev3Months) {
      const monthMap = new Map<string, number>();
      for (const e of expenses) {
        if (e.date.startsWith(month)) {
          monthMap.set(e.category, (monthMap.get(e.category) ?? 0) + e.amount);
        }
      }
      prevMonthlyByCategory.set(month, monthMap);
    }

    for (const [cat, currentTotal] of currentByCategory) {
      if (currentTotal <= 10000) continue;

      const prevTotals = prev3Months.map(
        (m) => prevMonthlyByCategory.get(m)?.get(cat) ?? 0,
      );
      const prevAvg =
        prevTotals.reduce((s, v) => s + v, 0) / prev3Months.length;

      if (prevAvg > 0 && currentTotal >= prevAvg * 2) {
        alerts.push({
          level: "warn",
          title: `${cat}が急増しています`,
          detail: `今月${currentTotal.toLocaleString("ja-JP")}円（直近3ヶ月平均${Math.round(prevAvg).toLocaleString("ja-JP")}円の${Math.round((currentTotal / prevAvg) * 100)}%）`,
        });
      }
    }
  }

  return alerts;
}

/**
 * ランウェイ（資金繰り）を計算する。
 * 直近3ヶ月の平均月次ネットをベースに算出。
 * - burning: 赤字→残高が約N ヶ月で尽きる
 * - growing: 黒字→資産は増加傾向
 * - flat: ほぼ収支ゼロ（月次絶対値1000円未満）
 */
export function runway(
  balance: number,
  series: readonly MonthlyPoint[],
): RunwayResult {
  const last3 = series.slice(Math.max(0, series.length - 3));
  const monthlyNet =
    last3.length > 0
      ? last3.reduce((sum, m) => sum + m.net, 0) / last3.length
      : 0;

  if (Math.abs(monthlyNet) < 1000) {
    return { monthlyNet, months: null, status: "flat" };
  }

  if (monthlyNet > 0) {
    return { monthlyNet, months: null, status: "growing" };
  }

  const months = Math.floor(balance / Math.abs(monthlyNet));
  return { monthlyNet, months, status: "burning" };
}

/**
 * 法人税の概算を算出する。
 *
 * 会計仮定:
 * - 売上: 発行済/送付済/入金済の請求書の税込合計（暦年の年初から今日まで）
 * - 経費: 全経費合計（同じ期間）
 * - 年換算: YTD利益を経過月数で按分
 * - 法人税概算: 中小法人 所得800万以下≒23%、超過分≒34%
 *   （法人税・地方法人税・住民税・事業税を含む実効税率の粗い目安）
 * ※ これは目安であり、正式な税額・税率ではありません。
 */
export function taxEstimate(
  invoices: readonly DocumentRecord[],
  expenses: readonly Expense[],
  today: Date,
): TaxEstimateResult {
  const yearStr = String(today.getFullYear());
  const todayStr = toIsoDate(today);

  const isYtd = (dateStr: string): boolean =>
    dateStr >= `${yearStr}-01-01` && dateStr <= todayStr;

  const ytdBusinessRevenue = invoices
    .filter((inv) => isBilledInvoice(inv) && isYtd(inv.issueDate))
    .reduce((sum, inv) => sum + summarize(inv.items).total, 0);

  const ytdBusinessExpense = expenses
    .filter((e) => isYtd(e.date))
    .reduce((sum, e) => sum + e.amount, 0);

  const ytdProfit = ytdBusinessRevenue - ytdBusinessExpense;

  // 経過月数（1〜12）で年換算
  const elapsedMonths = today.getMonth() + 1;
  const annualizedProfit =
    elapsedMonths > 0 ? Math.round((ytdProfit / elapsedMonths) * 12) : 0;

  // 中小法人実効税率の概算（目安）
  const THRESHOLD = 8_000_000;
  let estimatedTax = 0;
  if (annualizedProfit > 0) {
    if (annualizedProfit <= THRESHOLD) {
      estimatedTax = Math.round(annualizedProfit * 0.23);
    } else {
      estimatedTax = Math.round(
        THRESHOLD * 0.23 + (annualizedProfit - THRESHOLD) * 0.34,
      );
    }
  }

  return {
    ytdBusinessRevenue,
    ytdBusinessExpense,
    ytdProfit,
    annualizedProfit,
    estimatedTax,
    disclaimer:
      "この数値はあくまで目安です。実際の法人税額は税率区分・各種控除・地方法人税・住民税・事業税等により異なります。正式な税額は税理士にご確認ください。役員報酬の水準を調整することで法人税と個人所得税の合計を最適化できる場合があります。",
  };
}
