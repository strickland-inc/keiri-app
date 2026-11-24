import { SectionCard } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { formatYen } from "@/domain/money";
import type { MonthlyPoint, RunwayResult } from "@/domain/finance";
import { CashBalanceInput } from "./CashBalanceInput";

/** 月ごとの収支を、0 を中心にした左右の棒で見せる。 */
function NetBars({ series }: { series: readonly MonthlyPoint[] }) {
  const maxAbs = Math.max(...series.map((m) => Math.abs(m.net)), 1);
  return (
    <ul className="flex flex-col gap-2">
      {series.map((m) => {
        const width = `${(Math.abs(m.net) / maxAbs) * 100}%`;
        return (
          <li key={m.month} className="flex items-center gap-3 text-xs">
            <span className="w-9 shrink-0 text-ink-muted">
              {Number(m.month.slice(5))}月
            </span>
            <div
              className="grid flex-1 grid-cols-2 items-center"
              aria-hidden="true"
            >
              <div className="flex justify-end">
                {m.net < 0 && (
                  <div
                    className="h-2 rounded-l-full bg-danger/60"
                    style={{ width }}
                  />
                )}
              </div>
              <div className="border-l border-line-strong">
                {m.net > 0 && (
                  <div
                    className="h-2 rounded-r-full bg-brand-500"
                    style={{ width }}
                  />
                )}
              </div>
            </div>
            <span
              className={cn(
                "w-24 shrink-0 text-right tabular",
                m.net < 0 ? "text-danger" : "text-ink",
              )}
            >
              {formatYen(m.net)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** 残高と収支から見た、資金の見通し（ランウェイ）。 */
function RunwaySummary({ runway }: { runway: RunwayResult }) {
  if (runway.status === "growing") {
    return (
      <p className="flex items-center gap-2 text-sm font-medium text-success">
        <Icon name="trending_up" className="text-[18px]" />
        増加傾向
      </p>
    );
  }
  if (runway.status === "flat") {
    return (
      <p className="flex items-center gap-2 text-sm text-ink-muted">
        <Icon name="trending_flat" className="text-[18px]" />
        均衡
      </p>
    );
  }
  return (
    <p className="flex items-center gap-2 text-sm font-medium">
      <Icon name="warning" className="text-[18px] text-warning" />
      残高があと <span className="tabular text-danger">
        {runway.months}
      </span>{" "}
      ヶ月
    </p>
  );
}

interface MonthlyCashflowProps {
  series: readonly MonthlyPoint[];
  /** 現金残高。未入力なら null。 */
  cashBalance: number | null;
  runway: RunwayResult | null;
}

export function MonthlyCashflow({
  series,
  cashBalance,
  runway,
}: MonthlyCashflowProps) {
  return (
    <SectionCard title="キャッシュフローとランウェイ">
      <div className="flex flex-col gap-6">
        <NetBars series={series} />

        <div className="flex flex-col gap-3 border-t border-line pt-5">
          {cashBalance != null && (
            <>
              <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
                <span className="text-sm text-ink-muted">残高</span>
                <span className="text-xl font-semibold tabular tracking-tight">
                  {formatYen(cashBalance)}
                </span>
                {runway && (
                  <>
                    <span className="text-sm text-ink-muted">
                      月次収支の平均
                    </span>
                    <span
                      className={cn(
                        "text-sm font-medium tabular",
                        runway.monthlyNet < 0 && "text-danger",
                      )}
                    >
                      {formatYen(runway.monthlyNet)}
                    </span>
                  </>
                )}
              </div>
              {runway && <RunwaySummary runway={runway} />}
            </>
          )}
          <CashBalanceInput currentBalance={cashBalance} />
        </div>
      </div>
    </SectionCard>
  );
}
