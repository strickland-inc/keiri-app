/**
 * 決算集計の組み立て。会社コンテキストと期番号から expenses / documents / revenues /
 * parties を集め、buildClosing を呼ぶ。/closing ページと決算 API の3か所で共通して使う。
 */
import type { Issuer } from "@/domain/issuer";
import type { Expense } from "@/domain/expense";
import type { Revenue } from "@/domain/revenue";
import { buildClosing, type ClosingReport } from "@/domain/closing";
import {
  currentTerm,
  fiscalYear,
  hasFiscalSettings,
  type FiscalYear,
} from "@/domain/fiscal-year";
import { companyScope, type CompanyContext } from "@/lib/active-company";
import type { Repositories } from "@/repositories/types";

export function isValidClosingTerm(term: number): boolean {
  return Number.isInteger(term) && term >= 1;
}

/** 期の既定は、直近で締まった期（今期の1つ前）。1未満にはしない。 */
export function defaultClosingTerm(
  issuer: Pick<Issuer, "fiscalYearEndMonth" | "firstFiscalYearEnd">,
  today: Date,
): number {
  const term = currentTerm(issuer, today) - 1;
  return term < 1 ? 1 : term;
}

export interface LoadedClosing {
  fiscalYear: FiscalYear;
  /** 期内の経費（要確認を含む全カテゴリ）。freee 取込 CSV（経費）に使う。 */
  expenses: Expense[];
  /** 期内の売上台帳。freee 取込 CSV（売上）に使う。 */
  revenues: Revenue[];
  report: ClosingReport;
}

export async function loadClosing(
  repos: Repositories,
  company: CompanyContext,
  term: number,
): Promise<LoadedClosing | null> {
  if (!company.active || !hasFiscalSettings(company.active)) return null;

  const fy = fiscalYear(company.active, term);
  const scope = companyScope(company);

  const [allExpenses, documents, revenues, parties] = await Promise.all([
    repos.expenses.list(scope),
    repos.documents.list(scope),
    repos.revenues.list({ ...scope, from: fy.from, to: fy.to }),
    repos.parties.list(),
  ]);
  const expenses = allExpenses.filter(
    (e) => e.date >= fy.from && e.date <= fy.to,
  );

  const report = buildClosing({
    fiscalYear: fy,
    expenses,
    documents,
    revenues,
    parties,
  });

  return { fiscalYear: fy, expenses, revenues, report };
}
