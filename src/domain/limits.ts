/**
 * 入力の上限。画面と API が同じ値を使う。
 * 帳票のタブは明細 1 件で 1 行を使うので、件数の上限がないと、1 回の操作で数千行のタブができてしまう。
 */
export const LIMITS = {
  /** 1 つの書類の明細の件数。 */
  items: 100,
  /** 品名、件名、取引先名などの 1 行の文字。 */
  line: 200,
  /** 備考、振込先、住所などの複数行の文字。 */
  text: 2000,
  /** 金額・単価の絶対値（円）。 */
  amount: 10_000_000_000,
} as const;

/** 存在する日付か（YYYY-MM-DD）。 */
export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

/** 円の金額として使える整数か。 */
export function isYen(value: number): boolean {
  return Number.isInteger(value) && Math.abs(value) <= LIMITS.amount;
}
