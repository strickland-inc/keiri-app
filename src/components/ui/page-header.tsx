import type { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  description?: string;
  /** 右側の操作ボタン群。 */
  actions?: ReactNode;
}

/** 全画面共通のページ見出し（タイトル・補足・操作ボタン）。 */
export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          {title}
        </h1>
        {description && (
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-ink-muted">
            {description}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      )}
    </div>
  );
}
