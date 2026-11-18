/**
 * 事業年度。決算月と第1期の期末日から、期（第n期）の期間を求める。
 * Issuer に設定が無ければ扱えない（hasFiscalSettings で判定）。
 */
import type { Issuer } from "./issuer";

export interface FiscalYear {
  term: number;
  from: string;
  to: string;
  label: string;
}

type FiscalSettings = Pick<Issuer, "fiscalYearEndMonth" | "firstFiscalYearEnd">;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function parseISODate(s: string): { year: number; month: number; day: number } {
  const [year, month, day] = s.split("-").map(Number);
  return { year, month, day };
}

function toISODate(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function addDays(dateISO: string, days: number): string {
  const { year, month, day } = parseISODate(dateISO);
  const dt = new Date(Date.UTC(year, month - 1, day));
  dt.setUTCDate(dt.getUTCDate() + days);
  return toISODate(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

function subYears(dateISO: string, years: number): string {
  const { year, month, day } = parseISODate(dateISO);
  const newYear = year - years;
  const newDay = Math.min(day, lastDayOfMonth(newYear, month));
  return toISODate(newYear, month, newDay);
}

function formatSlash(dateISO: string): string {
  const { year, month, day } = parseISODate(dateISO);
  return `${year}/${month}/${day}`;
}

function dateToISO(date: Date): string {
  return toISODate(
    date.getUTCFullYear(),
    date.getUTCMonth() + 1,
    date.getUTCDate(),
  );
}

/** 決算月と第1期の期末日が、期の計算に使える形で設定されているか。 */
export function hasFiscalSettings(issuer: FiscalSettings): boolean {
  const { fiscalYearEndMonth, firstFiscalYearEnd } = issuer;
  return (
    typeof fiscalYearEndMonth === "number" &&
    Number.isInteger(fiscalYearEndMonth) &&
    fiscalYearEndMonth >= 1 &&
    fiscalYearEndMonth <= 12 &&
    typeof firstFiscalYearEnd === "string" &&
    firstFiscalYearEnd.length > 0
  );
}

/** 第 term 期の期間。第1期は期末日の1年前の翌日から、第2期以降は前期末の翌日から始まる。 */
export function fiscalYear(issuer: FiscalSettings, term: number): FiscalYear {
  if (!hasFiscalSettings(issuer)) {
    throw new Error("この会社には事業年度の設定がありません");
  }
  const month = issuer.fiscalYearEndMonth as number;
  const firstEnd = issuer.firstFiscalYearEnd as string;
  const { year: firstYear } = parseISODate(firstEnd);

  const toYear = firstYear + (term - 1);
  const to = toISODate(toYear, month, lastDayOfMonth(toYear, month));
  const from =
    term === 1
      ? addDays(subYears(to, 1), 1)
      : addDays(fiscalYear(issuer, term - 1).to, 1);

  return {
    term,
    from,
    to,
    label: `第${term}期（${formatSlash(from)}〜${formatSlash(to)}）`,
  };
}

/** today を含む期の番号。設定が無ければ 0。 */
export function currentTerm(issuer: FiscalSettings, today: Date): number {
  if (!hasFiscalSettings(issuer)) return 0;
  const todayISO = dateToISO(today);
  // 無限ループを避ける上限。
  let term = 1;
  while (term <= 1000) {
    if (todayISO <= fiscalYear(issuer, term).to) return term;
    term += 1;
  }
  return term;
}

/** 第1期から today を含む期までの一覧。設定が無ければ空。 */
export function listFiscalYears(
  issuer: FiscalSettings,
  today: Date,
): FiscalYear[] {
  if (!hasFiscalSettings(issuer)) return [];
  const term = currentTerm(issuer, today);
  const result: FiscalYear[] = [];
  for (let t = 1; t <= term; t += 1) {
    result.push(fiscalYear(issuer, t));
  }
  return result;
}

/** date が属する期。第1期より前、または設定が無ければ null。 */
export function fiscalYearOf(
  issuer: FiscalSettings,
  date: string,
): FiscalYear | null {
  if (!hasFiscalSettings(issuer)) return null;
  // 無限ループを避ける上限。
  let term = 1;
  while (term <= 1000) {
    const fy = fiscalYear(issuer, term);
    if (date < fy.from) return null;
    if (date <= fy.to) return fy;
    term += 1;
  }
  return null;
}
