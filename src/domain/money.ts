/**
 * 金額・消費税の計算。日本のインボイス制度に合わせ、税率別に集計する。
 * 金額はすべて「円・整数」で扱う（浮動小数の誤差を避ける）。
 */

export type TaxRate = 0 | 0.08 | 0.1;

export const TAX_RATE_LABELS: Record<string, string> = {
  "0": "非課税",
  "0.08": "8%（軽減）",
  "0.1": "10%",
};

export type Rounding = "floor" | "round" | "ceil";

export interface TaxLine {
  rate: TaxRate;
  /** その税率の税抜合計 */
  taxableAmount: number;
  /** その税率の消費税額 */
  taxAmount: number;
}

export interface AmountSummary {
  /** 税抜合計 */
  subtotal: number;
  /** 税率別の内訳 */
  taxLines: TaxLine[];
  /** 消費税合計 */
  taxTotal: number;
  /** 税込合計 */
  total: number;
}

interface ItemLike {
  quantity: number;
  unitPrice: number;
  taxRate: TaxRate;
}

/** 明細1行の税抜金額（数量 × 単価、円未満切り捨て）。 */
export function lineAmount(item: ItemLike): number {
  return Math.trunc(item.quantity * item.unitPrice);
}

function makeRounder(rounding: Rounding): (n: number) => number {
  if (rounding === "round") return Math.round;
  if (rounding === "ceil") return Math.ceil;
  return Math.floor;
}

/**
 * 明細群から税率別の小計・消費税・合計を求める。
 * 消費税は「税率ごとの税抜合計」に対して一度だけ丸める（インボイス方式）。
 */
export function summarize(
  items: readonly ItemLike[],
  rounding: Rounding = "floor",
): AmountSummary {
  const byRate = new Map<TaxRate, number>();
  for (const it of items) {
    const amt = lineAmount(it);
    byRate.set(it.taxRate, (byRate.get(it.taxRate) ?? 0) + amt);
  }

  const round = makeRounder(rounding);
  const taxLines: TaxLine[] = [];
  let subtotal = 0;
  let taxTotal = 0;

  const sortedRates = [...byRate.entries()].sort((a, b) => a[0] - b[0]);
  for (const [rate, taxableAmount] of sortedRates) {
    const taxAmount = round(taxableAmount * rate);
    taxLines.push({ rate, taxableAmount, taxAmount });
    subtotal += taxableAmount;
    taxTotal += taxAmount;
  }

  return { subtotal, taxLines, taxTotal, total: subtotal + taxTotal };
}

/** フォームの文字列を税率にする。0%・8%・10% 以外は 10% として扱う。 */
export function parseTaxRate(s: string): TaxRate {
  const n = Number(s);
  if (n === 0 || n === 0.08 || n === 0.1) return n;
  return 0.1;
}

/** 円表記（¥1,234）。 */
export function formatYen(n: number): string {
  return "¥" + Math.trunc(n).toLocaleString("ja-JP");
}
