import { monthlyProfitAndLoss, monthsOf } from "@/domain/accounting";
import { PageHeader } from "@/components/ui/page-header";
import {
  Table,
  TableCard,
  TBody,
  Td,
  Th,
  THead,
  Tr,
} from "@/components/ui/table";
import {
  Amount,
  AccountingNote,
  FiscalYearTabs,
  tableFootRowClass,
} from "../_components";
import { loadAccounting } from "../_lib";

export const dynamic = "force-dynamic";

export default async function MonthlyPage({
  searchParams,
}: {
  searchParams: Promise<{ fy?: string }>;
}) {
  const { fy: fyParam } = await searchParams;
  const { journal, fy, years, today } = await loadAccounting(fyParam);

  const rows = monthlyProfitAndLoss(journal, monthsOf(fy));
  const total = rows.reduce(
    (t, r) => ({
      revenue: t.revenue + r.revenue,
      expense: t.expense + r.expense,
      netIncome: t.netIncome + r.netIncome,
    }),
    { revenue: 0, expense: 0, netIncome: 0 },
  );
  // 棒グラフは売上・費用のうち最大の月を 100% とする
  const scale = Math.max(...rows.flatMap((r) => [r.revenue, r.expense]), 1);
  const thisMonth = today.slice(0, 7);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="損益計算書（月次）"
        description={`${fy.label}の売上・費用・純利益を月ごとに見ます。`}
        actions={
          <FiscalYearTabs
            years={years}
            current={fy}
            basePath="/accounting/monthly"
          />
        }
      />

      <TableCard>
        <Table>
          <THead>
            <Th>月</Th>
            <Th align="right">売上高</Th>
            <Th align="right">費用</Th>
            <Th align="right">純利益</Th>
            <Th className="hidden w-48 sm:table-cell">
              <span className="inline-flex items-center gap-3">
                <LegendDot className="bg-ink" />
                売上
                <LegendDot className="bg-line-strong" />
                費用
              </span>
            </Th>
          </THead>
          <TBody>
            {rows.map((r) => {
              const future = r.month > thisMonth;
              return (
                <Tr
                  key={r.month}
                  className={future ? "text-ink-muted/60" : undefined}
                >
                  <Td nowrap numeric>
                    {r.month.replace("-", "年")}月
                    {r.month === thisMonth && (
                      <span className="ml-2 text-xs text-brand-600">今月</span>
                    )}
                  </Td>
                  <Td align="right">
                    <Amount value={r.revenue} />
                  </Td>
                  <Td align="right">
                    <Amount value={r.expense} />
                  </Td>
                  <Td align="right" className="font-medium">
                    <Amount value={r.netIncome} />
                  </Td>
                  <Td className="hidden sm:table-cell">
                    <div className="flex flex-col gap-1" aria-hidden="true">
                      <div
                        className="h-1.5 rounded-full bg-ink"
                        style={{ width: `${(r.revenue / scale) * 100}%` }}
                      />
                      <div
                        className="h-1.5 rounded-full bg-line-strong"
                        style={{ width: `${(r.expense / scale) * 100}%` }}
                      />
                    </div>
                  </Td>
                </Tr>
              );
            })}
          </TBody>
          <tfoot>
            <tr className={tableFootRowClass}>
              <Td>合計</Td>
              <Td align="right">
                <Amount value={total.revenue} />
              </Td>
              <Td align="right">
                <Amount value={total.expense} />
              </Td>
              <Td align="right">
                <Amount value={total.netIncome} />
              </Td>
              <Td className="hidden sm:table-cell" />
            </tr>
          </tfoot>
        </Table>
      </TableCard>

      <AccountingNote />
    </div>
  );
}

function LegendDot({ className }: { className: string }) {
  return <span className={`inline-block size-2 rounded-full ${className}`} />;
}
