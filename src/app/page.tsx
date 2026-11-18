import { getRepositories } from "@/repositories";
import { SectionCard } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import {
  companyScope,
  companySettingKey,
  loadCompanyContext,
} from "@/lib/active-company";
import { monthlySeries, runway, taxEstimate } from "@/domain/finance";
import { recentMonths, toYearMonth } from "@/domain/dates";
import { AiFinanceAdvice } from "./_components/AiFinanceAdvice";
import { MonthlyCashflow } from "./_components/MonthlyCashflow";
import { MonthStats } from "./_components/OverviewStats";
import { RecentDocuments } from "./_components/RecentDocuments";
import { TaxEstimate } from "./_components/TaxEstimate";

export const dynamic = "force-dynamic";

const RECENT_DOCUMENT_COUNT = 8;
const CASHFLOW_MONTHS = 12;

/** 設定に保存された現金残高。未入力なら null。 */
function parseCashBalance(raw: string | undefined): number | null {
  return raw != null && raw !== "" ? Number(raw) : null;
}

export default async function HomePage() {
  const repos = await getRepositories();
  const company = await loadCompanyContext(repos);
  const scope = companyScope(company);
  const [documents, parties, expenses, settings] = await Promise.all([
    repos.documents.list(scope),
    repos.parties.list(),
    repos.expenses.list(scope),
    repos.settings.all(),
  ]);

  const now = new Date();
  const thisMonth = toYearMonth(now);

  // 最近更新した書類
  const recentDocuments = [...documents]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, RECENT_DOCUMENT_COUNT);

  // 収支・資金の見通し
  const series = monthlySeries(
    expenses,
    documents,
    recentMonths(CASHFLOW_MONTHS, now),
  );
  const currentMonth = series[series.length - 1] ?? {
    month: thisMonth,
    income: 0,
    expense: 0,
    net: 0,
  };
  // 現金残高は会社ごとに持つ。会社別のキーがまだ無い間は、会社導入前の値を引き継ぐ。
  const cashBalance = parseCashBalance(
    settings[companySettingKey(company, "cash_balance")] ??
      (company.active?.id === company.defaultId
        ? settings["cash_balance"]
        : undefined),
  );

  return (
    <div className="flex flex-col gap-10">
      <PageHeader title="ホーム" description={company.active?.name} />

      <RecentDocuments
        documents={recentDocuments}
        partyNames={new Map(parties.map((p) => [p.id, p.name]))}
      />

      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold">今月の収支</h2>
        <MonthStats month={currentMonth} />
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <MonthlyCashflow
          series={series}
          cashBalance={cashBalance}
          runway={cashBalance != null ? runway(cashBalance, series) : null}
        />
        <div className="flex flex-col gap-6">
          <TaxEstimate estimate={taxEstimate(documents, expenses, now)} />
          <SectionCard title="AI 改善提案">
            <AiFinanceAdvice />
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
