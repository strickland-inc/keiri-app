import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Card } from "./card";

/** 一覧表の外枠。幅が足りないときは横スクロールする。 */
export function TableCard({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("overflow-hidden", className)}>
      <div className="overflow-x-auto">{children}</div>
    </Card>
  );
}

export function Table({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <table className={cn("w-full text-sm", className)}>{children}</table>;
}

export function THead({ children }: { children: ReactNode }) {
  return (
    <thead>
      <tr className="border-b border-line bg-canvas/60 text-left text-xs text-ink-muted">
        {children}
      </tr>
    </thead>
  );
}

interface CellProps {
  children?: ReactNode;
  className?: string;
  /** 数値・金額の列は右寄せ。 */
  align?: "left" | "right";
  colSpan?: number;
}

export function Th({ children, className, align = "left" }: CellProps) {
  return (
    <th
      className={cn(
        "whitespace-nowrap px-4 py-3 font-medium",
        align === "right" && "text-right",
        className,
      )}
    >
      {children}
    </th>
  );
}

export function TBody({ children }: { children: ReactNode }) {
  return <tbody className="divide-y divide-line">{children}</tbody>;
}

export function Tr({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <tr className={cn("transition-colors hover:bg-canvas/70", className)}>
      {children}
    </tr>
  );
}

interface TdProps extends CellProps {
  /** 金額など。等幅数字にする。 */
  numeric?: boolean;
  muted?: boolean;
  /** 折り返さない。 */
  nowrap?: boolean;
}

export function Td({
  children,
  className,
  align = "left",
  numeric,
  muted,
  nowrap,
  colSpan,
}: TdProps) {
  return (
    <td
      colSpan={colSpan}
      className={cn(
        "px-4 py-3",
        align === "right" && "text-right",
        numeric && "tabular",
        muted ? "text-ink-muted" : "text-ink",
        nowrap && "whitespace-nowrap",
        className,
      )}
    >
      {children}
    </td>
  );
}
