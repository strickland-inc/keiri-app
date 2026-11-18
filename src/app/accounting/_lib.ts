import { getRepositories } from "@/repositories";
import {
  buildJournal,
  fiscalYear,
  fiscalYearOf,
  type FiscalYear,
  type JournalEntry,
} from "@/domain/accounting";
import { todayIso } from "@/lib/utils";
import { companyScope, loadCompanyContext } from "@/lib/active-company";

export interface AccountingData {
  journal: JournalEntry[];
  today: string;
  fiscalStartMonth: number;
  /** 表示中の会計年度。 */
  fy: FiscalYear;
  /** 選べる会計年度（新しい順）。 */
  years: FiscalYear[];
}

function parseStartMonth(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= 12 ? n : 1;
}

/**
 * 会計画面共通のデータ取得。請求書と経費から仕訳を作り、`?fy=` で会計年度を決める。
 *
 * - 帳簿はサイドバーで選んだ会社のもの（請求書・経費を会社で絞る）。
 * - 銀行明細には会社の列が無い。会社が未設定の既存データと同じ扱いにして、
 *   既定の会社を見ているときだけ仕訳に入れる（別の会社の帳簿に混ざらないようにする）。
 * - 期首の月は、会社に決算月があればその翌月、無ければ設定 `fiscal_start_month`（既定 1）。
 */
export async function loadAccounting(
  fyParam?: string,
): Promise<AccountingData> {
  const repos = await getRepositories();
  const company = await loadCompanyContext(repos);
  const scope = companyScope(company);
  const [documents, expenses, parties, settings, bankTransactions] =
    await Promise.all([
      repos.documents.list({ ...scope, type: "invoice" }),
      repos.expenses.list(scope),
      repos.parties.list(),
      repos.settings.all(),
      repos.bankTransactions.list(),
    ]);

  const today = todayIso();
  const endMonth = company.active?.fiscalYearEndMonth;
  const fiscalStartMonth =
    endMonth !== undefined
      ? (endMonth % 12) + 1
      : parseStartMonth(settings["fiscal_start_month"]);
  const includeBank = !scope.issuerId || scope.includeUnassigned === true;
  const journal = buildJournal(
    documents,
    expenses,
    new Map(parties.map((p) => [p.id, p.name])),
    includeBank ? bankTransactions : [],
  );

  const current = fiscalYearOf(today, fiscalStartMonth);
  const earliest = journal[0]
    ? fiscalYearOf(journal[0].date, fiscalStartMonth).year
    : current.year;
  const years: FiscalYear[] = [];
  for (let y = current.year; y >= Math.min(earliest, current.year); y--) {
    years.push(fiscalYear(y, fiscalStartMonth));
  }

  const requested = Number(fyParam);
  const fy = years.find((f) => f.year === requested) ?? years[0] ?? current;
  return { journal, today, fiscalStartMonth, fy, years };
}

/** 科目の総勘定元帳へのリンク。 */
export function ledgerHref(account: string, fyYear: number): string {
  return `/accounting/ledger?account=${encodeURIComponent(account)}&fy=${fyYear}`;
}
