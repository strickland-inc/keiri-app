import { cn } from "@/lib/utils";

/** 読み込み中の骨組み。大きさは className で指定する。 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div className={cn("animate-pulse rounded-lg bg-line/70", className)} />
  );
}
