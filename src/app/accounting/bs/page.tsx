import { balanceSheet } from "@/domain/accounting";
import { formatJpDate } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import {
  AccountRows,
  FiscalYearTabs,
  GrandTotalCard,
  SectionCard,
  TotalRow,
} from "../_components";
import { ledgerHref, loadAccounting } from "../_lib";
import { requirePageSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function BalanceSheetPage({
  searchParams,
}: {
  searchParams: Promise<{ fy?: string }>;
}) {
  await requirePageSession();
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
        actions={
          <>
            <span className="tabular text-sm text-ink-muted">
              {formatJpDate(asOf)}
            </span>
            <FiscalYearTabs
              years={years}
              current={fy}
              basePath="/accounting/bs"
            />
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-6">
          <SectionCard title="資産の部">
            <AccountRows rows={bs.assets} hrefFor={toLedger} />
            <TotalRow label="資産合計" value={bs.totalAssets} strong />
          </SectionCard>
        </div>

        <div className="flex flex-col gap-6">
          <SectionCard title="負債の部">
            <AccountRows rows={bs.liabilities} hrefFor={toLedger} />
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

      <div>
        <Badge tone={bs.balanced ? "success" : "danger"}>
          {bs.balanced ? "貸借一致" : "貸借不一致"}
        </Badge>
      </div>
    </div>
  );
}
