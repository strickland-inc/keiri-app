import { profitAndLoss } from "@/domain/accounting";
import { formatYen } from "@/domain/money";
import { formatJpDate } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page-header";
import { Stat } from "@/components/ui/stat";
import {
  AccountRows,
  AccountingNote,
  FiscalYearTabs,
  GrandTotalCard,
  SectionCard,
  TotalRow,
} from "../_components";
import { ledgerHref, loadAccounting } from "../_lib";

export const dynamic = "force-dynamic";

export default async function ProfitAndLossPage({
  searchParams,
}: {
  searchParams: Promise<{ fy?: string }>;
}) {
  const { fy: fyParam } = await searchParams;
  const { journal, fy, years, today } = await loadAccounting(fyParam);

  // 当期の途中なら今日までを集計する
  const to = today < fy.to && today >= fy.from ? today : fy.to;
  const pl = profitAndLoss(journal, { from: fy.from, to });
  const margin =
    pl.totalRevenue > 0 ? (pl.netIncome / pl.totalRevenue) * 100 : null;
  const toLedger = (account: string) => ledgerHref(account, fy.year);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="損益計算書"
        description={`${formatJpDate(fy.from)} 〜 ${formatJpDate(to)}`}
        actions={
          <FiscalYearTabs
            years={years}
            current={fy}
            basePath="/accounting/pl"
          />
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="収益" value={formatYen(pl.totalRevenue)} />
        <Stat label="費用" value={formatYen(pl.totalExpense)} />
        <Stat
          label="当期純利益"
          value={formatYen(pl.netIncome)}
          hint={margin === null ? undefined : `利益率 ${margin.toFixed(1)}%`}
          tone={pl.netIncome < 0 ? "negative" : "default"}
        />
      </div>

      <div className="flex flex-col gap-6">
        <SectionCard title="収益">
          <AccountRows
            rows={pl.revenues}
            hrefFor={toLedger}
            emptyText="この期間の売上はありません"
          />
          <TotalRow label="収益合計" value={pl.totalRevenue} />
        </SectionCard>

        <SectionCard title="費用">
          <AccountRows
            rows={pl.expenses}
            hrefFor={toLedger}
            emptyText="この期間の経費はありません"
          />
          <TotalRow label="費用合計" value={pl.totalExpense} />
        </SectionCard>

        <GrandTotalCard
          label="当期純利益（収益 − 費用）"
          value={pl.netIncome}
        />
      </div>

      <AccountingNote />
    </div>
  );
}
