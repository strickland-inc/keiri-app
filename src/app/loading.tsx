import { Skeleton } from "@/components/ui/skeleton";

function StatSkeleton() {
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-line p-5">
      <Skeleton className="h-3.5 w-24" />
      <Skeleton className="h-7 w-32" />
    </div>
  );
}

/** ホームの読み込み中表示（実際の並びと同じ骨組み）。 */
export default function HomeLoading() {
  return (
    <div className="flex flex-col gap-10" aria-busy="true">
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-28" />
        <Skeleton className="h-10 w-32 rounded-full" />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatSkeleton />
        <StatSkeleton />
        <StatSkeleton />
      </div>

      <div className="rounded-2xl border border-line">
        <div className="border-b border-line px-5 py-4">
          <Skeleton className="h-4 w-24" />
        </div>
        <div className="flex flex-col gap-4 p-5">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-5 w-full" />
          ))}
        </div>
      </div>
    </div>
  );
}
