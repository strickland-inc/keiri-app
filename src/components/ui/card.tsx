import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface BoxProps {
  className?: string;
  children: ReactNode;
}

/** 枠付きの面。影は付けず、薄い枠線で区切る。 */
export function Card({ className, children }: BoxProps) {
  return (
    <div className={cn("rounded-2xl border border-line bg-surface", className)}>
      {children}
    </div>
  );
}

export function CardHeader({ className, children }: BoxProps) {
  return (
    <div className={cn("border-b border-line px-5 py-4", className)}>
      {children}
    </div>
  );
}

export function CardBody({ className, children }: BoxProps) {
  return <div className={cn("p-5", className)}>{children}</div>;
}

/** カード内の見出し行（タイトル + 右側の操作）。 */
export function CardTitle({
  title,
  action,
}: {
  title: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <h2 className="text-sm font-semibold text-ink">{title}</h2>
      {action}
    </div>
  );
}

/** タイトル行つきのカード。本文は `p-5`。表など余白を付けたくない中身は `flush` を指定する。 */
export function SectionCard({
  title,
  action,
  flush,
  className,
  children,
}: {
  title: string;
  action?: ReactNode;
  flush?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle title={title} action={action} />
      </CardHeader>
      {flush ? children : <CardBody>{children}</CardBody>}
    </Card>
  );
}
