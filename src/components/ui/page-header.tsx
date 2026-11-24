import type { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  /** 右側の操作ボタン群。 */
  actions?: ReactNode;
}

/** 全画面共通のページ見出し（タイトル・操作ボタン）。 */
export function PageHeader({ title, actions }: PageHeaderProps) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          {title}
        </h1>
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      )}
    </div>
  );
}
