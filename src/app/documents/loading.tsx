import type { ReactElement } from "react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const HEADER_WIDTHS = ["w-24", "w-20", "w-28", "w-32", "w-24", "w-16"] as const;

export default function DocumentsLoading(): ReactElement {
  return (
    <div className="flex flex-col gap-8">
      {/* ページ見出し */}
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-10 w-28 rounded-full" />
      </div>

      {/* タブ */}
      <Skeleton className="h-10 w-96 max-w-full rounded-full" />

      {/* 表 */}
      <Card className="overflow-hidden">
        <div className="flex gap-6 border-b border-line bg-canvas/60 px-4 py-3.5">
          {HEADER_WIDTHS.map((w, i) => (
            <Skeleton key={i} className={`h-3 ${w}`} />
          ))}
        </div>
        <div className="divide-y divide-line">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center gap-6 px-4 py-3.5">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-4 w-36" />
              <Skeleton className="ml-auto h-4 w-20" />
              <Skeleton className="h-5 w-16 rounded-full" />
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
