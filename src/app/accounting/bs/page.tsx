import { balanceSheet } from "@/domain/accounting";
import { formatJpDate } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";
import { PageHeader } from "@/components/ui/page-header";
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

export default async function BalanceSheetPage({
  searchParams,
}: {
  searchParams: Promise<{ fy?: string }>;
}) {
  const { fy: fyParam } = await searchParams;
  const { journal, fy, years, today } = await loadAccounting(fyParam);

  // 当期の途中なら今日時点、過去の期なら期末時点
  const asOf = today < fy.to && today >= fy.from ? today : fy.to;
  const bs = balanceSheet(journal, asOf, fy.from);
  const toLedger = (account: string) => ledgerHref(account, fy.year);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="貸借対照表"
        description={`${formatJpDate(asOf)} 時点`}
        actions={
          <FiscalYearTabs
            years={years}
            current={fy}
            basePath="/accounting/bs"
          />
        }
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-6">
          <SectionCard title="資産の部">
            <AccountRows
              rows={bs.assets}
              hrefFor={toLedger}
              emptyText="資産はありません"
            />
            <TotalRow label="資産合計" value={bs.totalAssets} strong />
          </SectionCard>
        </div>

        <div className="flex flex-col gap-6">
          <SectionCard title="負債の部">
            <AccountRows
              rows={bs.liabilities}
              hrefFor={toLedger}
              emptyText="負債はありません"
            />
            <TotalRow label="負債合計" value={bs.totalLiabilities} />
          </SectionCard>

          <SectionCard title="純資産の部">
            <AccountRows rows={bs.equity} />
            <TotalRow label="純資産合計" value={bs.totalEquity} />
          </SectionCard>

          <GrandTotalCard
            label="負債・純資産合計"
            value={bs.totalLiabilities + bs.totalEquity}
          />
        </div>
      </div>

      <p
        className={`flex items-center gap-2 text-sm ${bs.balanced ? "text-success" : "text-danger"}`}
      >
        <Icon
          name={bs.balanced ? "check_circle" : "error"}
          className="text-[18px]"
        />
        {bs.balanced
          ? "資産合計と、負債・純資産合計が一致しています"
          : "資産合計と、負債・純資産合計が一致していません"}
      </p>

      <AccountingNote />
    </div>
  );
}
