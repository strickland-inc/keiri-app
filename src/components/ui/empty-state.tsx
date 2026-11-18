import type { ReactNode } from "react";
import { Icon } from "./icon";

interface EmptyStateProps {
  icon?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}

/** 一覧が空のときの案内。 */
export function EmptyState({
  icon = "inbox",
  title,
  description,
  action,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-line-strong px-6 py-14 text-center">
      <Icon name={icon} className="text-[32px] text-ink-faint" />
      <div>
        <p className="text-sm font-medium text-ink">{title}</p>
        {description && (
          <p className="mt-1 text-sm text-ink-muted">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}
