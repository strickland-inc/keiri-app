import { SectionCard } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatYen } from "@/domain/money";
import type { TaxEstimateResult } from "@/domain/finance";

function Row({
  label,
  value,
  negative,
}: {
  label: string;
  value: number;
  negative?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-3">
      <dt className="text-sm text-ink-muted">{label}</dt>
      <dd
        className={cn(
          "text-base font-semibold tabular tracking-tight",
          negative && "text-danger",
        )}
      >
        {formatYen(value)}
      </dd>
    </div>
  );
}

/** 税金・役員報酬の目安。今期の累計から、利益と法人税を年換算で概算する。 */
export function TaxEstimate({ estimate }: { estimate: TaxEstimateResult }) {
  return (
    <SectionCard title="税金・役員報酬の目安">
      <dl className="-my-3 divide-y divide-line">
        <Row label="売上" value={estimate.ytdBusinessRevenue} />
        <Row label="経費" value={estimate.ytdBusinessExpense} />
        <Row
          label="概算利益"
          value={estimate.annualizedProfit}
          negative={estimate.annualizedProfit < 0}
        />
        <Row label="法人税の概算" value={estimate.estimatedTax} />
      </dl>
    </SectionCard>
  );
}
