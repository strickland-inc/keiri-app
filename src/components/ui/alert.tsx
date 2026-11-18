import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Icon } from "./icon";

type AlertTone = "info" | "success" | "warning" | "danger";

const tone: Record<
  AlertTone,
  { box: string; iconColor: string; icon: string }
> = {
  info: {
    box: "border-line bg-canvas",
    iconColor: "text-ink-muted",
    icon: "info",
  },
  success: {
    box: "border-success/25 bg-success/5",
    iconColor: "text-success",
    icon: "check_circle",
  },
  warning: {
    box: "border-warning/30 bg-warning/5",
    iconColor: "text-warning",
    icon: "warning",
  },
  danger: {
    box: "border-danger/25 bg-danger/5",
    iconColor: "text-danger",
    icon: "error",
  },
};

/** 画面内のメッセージ（エラー・案内・成功）。 */
export function Alert({
  tone: t = "info",
  children,
  className,
}: {
  tone?: AlertTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      role={t === "danger" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2.5 rounded-[var(--radius)] border px-4 py-3 text-sm text-ink",
        tone[t].box,
        className,
      )}
    >
      <Icon
        name={tone[t].icon}
        className={cn("mt-px text-[18px]", tone[t].iconColor)}
      />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
