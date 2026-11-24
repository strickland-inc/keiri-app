import { Stat } from "@/components/ui/stat";
import { formatYen } from "@/domain/money";
import type { MonthlyPoint } from "@/domain/finance";

/** 今月の収支（収入・支出・差引）。 */
export function MonthStats({ month }: { month: MonthlyPoint }) {
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <Stat label="収入" value={formatYen(month.income)} />
      <Stat label="支出" value={formatYen(month.expense)} />
      <Stat
        label="収支"
        value={formatYen(month.net)}
        tone={month.net >= 0 ? "positive" : "negative"}
      />
    </div>
  );
}
