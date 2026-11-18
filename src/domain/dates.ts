/**
 * 日付の文字列化。どれもローカル時刻で数える。
 * toISOString は UTC に直すので、日本時間の朝 9 時前は前日になってしまう。使わない。
 */

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** YYYY-MM-DD */
export function toIsoDate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** YYYY-MM */
export function toYearMonth(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

/** base の月で終わる count か月分の YYYY-MM を、古い順に返す。 */
export function recentMonths(count: number, base: Date = new Date()): string[] {
  const months: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    months.push(
      toYearMonth(new Date(base.getFullYear(), base.getMonth() - i, 1)),
    );
  }
  return months;
}
