import type { ReactElement } from "react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

function SummaryBlockSkeleton(): ReactElement {
  return (
    <Card>
      <CardBody className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-8 w-36" />
          <Skeleton className="h-3 w-12" />
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-5 w-16" />
          <Skeleton className="h-3 w-28" />
        </div>
      </CardBody>
    </Card>
  );
}

function RankingCardSkeleton(): ReactElement {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-4 w-40" />
      </CardHeader>
      <CardBody className="flex flex-col gap-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Skeleton className="h-4 w-4 shrink-0" />
              <Skeleton className="h-4 w-32" />
            </div>
            <Skeleton className="h-4 w-20 shrink-0" />
          </div>
        ))}
      </CardBody>
    </Card>
  );
}

function SectionSkeleton({
  periodWidth,
}: {
  periodWidth: string;
}): ReactElement {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-baseline gap-2">
        <Skeleton className="h-4 w-10" />
        <Skeleton className={`h-3 ${periodWidth}`} />
      </div>
      <SummaryBlockSkeleton />
      <RankingCardSkeleton />
    </section>
  );
}

export default function ReportsLoading(): ReactElement {
  return (
    <div className="flex flex-col gap-10">
      <Skeleton className="h-8 w-28" />
      <SectionSkeleton periodWidth="w-36" />
      <SectionSkeleton periodWidth="w-24" />
    </div>
  );
}
