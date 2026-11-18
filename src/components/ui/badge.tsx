import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import {
  DOCUMENT_STATUS_LABELS,
  type DocumentStatus,
} from "@/domain/documents";

export type BadgeTone = "neutral" | "brand" | "success" | "warning" | "danger";

const toneClass: Record<BadgeTone, string> = {
  neutral: "bg-canvas text-ink-muted",
  brand: "bg-brand-50 text-brand-700",
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
  danger: "bg-danger/10 text-danger",
};

const dotClass: Record<BadgeTone, string> = {
  neutral: "bg-ink-faint",
  brand: "bg-brand-500",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
};

/** 小さな状態表示。色だけに頼らず、必ず文字を入れる。 */
export function Badge({
  tone = "neutral",
  children,
  className,
}: {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium",
        toneClass[tone],
        className,
      )}
    >
      <span className={cn("size-1.5 rounded-full", dotClass[tone])} />
      {children}
    </span>
  );
}

const statusTone: Record<DocumentStatus, BadgeTone> = {
  draft: "neutral",
  issued: "brand",
  sent: "warning",
  paid: "success",
  void: "neutral",
};

export function StatusBadge({ status }: { status: DocumentStatus }) {
  return (
    <Badge
      tone={statusTone[status]}
      className={status === "void" ? "line-through" : undefined}
    >
      {DOCUMENT_STATUS_LABELS[status]}
    </Badge>
  );
}
