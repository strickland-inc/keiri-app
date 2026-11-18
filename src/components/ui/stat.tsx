import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Card } from "./card";

type StatTone = "default" | "positive" | "negative" | "warning";

const toneClass: Record<StatTone, string> = {
  default: "text-ink",
  positive: "text-success",
  negative: "text-danger",
  warning: "text-warning",
};

interface StatProps {
  label: string;
  /** 表示する値（金額・件数など）。 */
  value: ReactNode;
  /** 値の右に小さく付ける単位（件、円 など）。 */
  unit?: string;
  hint?: string;
  tone?: StatTone;
  className?: string;
}

/** 数値カード（KPI）。 */
export function Stat({
  label,
  value,
  unit,
  hint,
  tone = "default",
  className,
}: StatProps) {
  return (
    <Card className={cn("flex flex-col gap-1 p-5", className)}>
      <p className="text-[13px] text-ink-muted">{label}</p>
      <p
        className={cn(
          "text-2xl font-semibold tabular tracking-tight",
          toneClass[tone],
        )}
      >
        {value}
        {unit && (
          <span className="ml-1 text-sm font-normal text-ink-muted">
            {unit}
          </span>
        )}
      </p>
      {hint && <p className="text-xs text-ink-muted">{hint}</p>}
    </Card>
  );
}
