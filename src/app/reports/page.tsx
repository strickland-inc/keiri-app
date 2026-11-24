import type { ReactElement } from "react";
import { getRepositories } from "@/repositories";
import { companyScope, loadCompanyContext } from "@/lib/active-company";
import {
  thisWeekRange,
  lastWeekRange,
  thisMonthRange,
  lastMonthRange,
  periodSummary,
  merchantRanking,
  changeRate,
  type MerchantRankItem,
} from "@/domain/reports";
import { formatYen } from "@/domain/money";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { PageHeader } from "@/components/ui/page-header";
import { RankingTabs } from "./ranking-tabs";
import { requirePageSession } from "@/lib/session";

export const dynamic = "force-dynamic";

const DOW_LABELS = ["日", "月", "火", "水", "木", "金", "土"] as const;

function fmtDate(iso: string): string {
  const parts = iso.split("-");
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  const date = new Date(y, m - 1, d);
  const dow = DOW_LABELS[date.getDay()];
  return `${m}/${d}（${dow}）`;
}

/** 前期間比。支出が増えた（+）ほど警告色、減った（−）ほど成功色にする。 */
function ChangeRate({ rate }: { rate: number | null }): ReactElement {
  if (rate === null) {
    return <span className="text-xs text-ink-muted">—</span>;
  }
  const sign = rate >= 0 ? "+" : "";
  const colorClass = rate >= 0 ? "text-danger" : "text-success";
  return (
    <span className={`text-sm font-semibold tabular ${colorClass}`}>
      {sign}
      {rate.toFixed(1)}%
    </span>
  );
}

function SummaryBlock({
  total,
  count,
  prevTotal,
  prevLabel,
  rate,
}: {
  total: number;
  count: number;
  prevTotal: number;
  prevLabel: string;
  rate: number | null;
}): ReactElement {
  return (
    <Card>
      <CardBody className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[13px] text-ink-muted">合計支出</p>
          <p className="mt-1 text-2xl font-semibold tabular tracking-tight text-ink">
            {formatYen(total)}
          </p>
          <p className="mt-1 text-xs tabular text-ink-muted">{count}件</p>
        </div>
        <div className="text-right">
          <p className="text-[13px] text-ink-muted">{prevLabel}比</p>
          <div className="mt-1">
            <ChangeRate rate={rate} />
          </div>
          <p className="mt-1 text-xs tabular text-ink-muted">
            {prevLabel} {formatYen(prevTotal)}
          </p>
        </div>
      </CardBody>
    </Card>
  );
}

function RankingCard({
  title,
  ranking,
}: {
  title: string;
  ranking: { byCount: MerchantRankItem[]; byAmount: MerchantRankItem[] };
}): ReactElement {
  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Icon name="leaderboard" className="text-[18px] text-ink-muted" />
          <h3 className="text-sm font-semibold text-ink">{title}</h3>
        </div>
      </CardHeader>
      <RankingTabs byCount={ranking.byCount} byAmount={ranking.byAmount} />
    </Card>
  );
}

function SectionHeading({
  title,
  period,
}: {
  title: string;
  period: string;
}): ReactElement {
  return (
    <div className="flex items-baseline gap-2">
      <h2 className="text-sm font-semibold text-ink">{title}</h2>
      <span className="text-xs text-ink-muted">{period}</span>
    </div>
  );
}

export default async function ReportsPage(): Promise<ReactElement> {
  await requirePageSession();
  const today = new Date();
  const repos = await getRepositories();
  const company = await loadCompanyContext(repos);
  const expenses = await repos.expenses.list(companyScope(company));

  const weekRange = thisWeekRange(today);
  const lastWeekRng = lastWeekRange(today);
  const monthRange = thisMonthRange(today);
  const lastMonthRng = lastMonthRange(today);

  const weekSum = periodSummary(expenses, weekRange);
  const lastWeekSum = periodSummary(expenses, lastWeekRng);
  const monthSum = periodSummary(expenses, monthRange);
  const lastMonthSum = periodSummary(expenses, lastMonthRng);

  const weekRate = changeRate(weekSum.total, lastWeekSum.total);
  const monthRate = changeRate(monthSum.total, lastMonthSum.total);

  const weekRanking = merchantRanking({ expenses, range: weekRange });
  const monthRanking = merchantRanking({ expenses, range: monthRange });

  const weekLabel = `${fmtDate(weekRange.from)}〜${fmtDate(weekRange.to)}`;
  const lastWeekLabel = `${fmtDate(lastWeekRng.from)}〜${fmtDate(lastWeekRng.to)}`;
  const monthLabel = `${today.getFullYear()}年${today.getMonth() + 1}月`;

  return (
    <div className="flex flex-col gap-10">
      <PageHeader title="レポート" />

      <section className="flex flex-col gap-4">
        <SectionHeading title="週次" period={weekLabel} />
        <SummaryBlock
          total={weekSum.total}
          count={weekSum.count}
          prevTotal={lastWeekSum.total}
          prevLabel={`先週（${lastWeekLabel}）`}
          rate={weekRate}
        />
        <RankingCard title="今週のよく使う利用先" ranking={weekRanking} />
      </section>

      <section className="flex flex-col gap-4">
        <SectionHeading title="月次" period={monthLabel} />
        <SummaryBlock
          total={monthSum.total}
          count={monthSum.count}
          prevTotal={lastMonthSum.total}
          prevLabel="先月"
          rate={monthRate}
        />
        <RankingCard title="今月のよく使う利用先" ranking={monthRanking} />
      </section>
    </div>
  );
}
