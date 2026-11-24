"use client";

import { Badge } from "@/components/ui/badge";
import { CopyButton } from "@/components/ui/copy-button";
import type { IssuedLink } from "./actions";

/** 作った時に 1 度だけ見せるリンク。コピーのボタンつき。origin は今開いているものを使う。 */
export function OneTimeLink({
  title,
  link,
}: {
  title: string;
  link: IssuedLink;
}) {
  const url = `${window.location.origin}${link.path}`;
  const expires = new Date(link.expiresAt).toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    dateStyle: "medium",
    timeStyle: "short",
  });

  return (
    <div className="flex flex-col gap-3 rounded-[var(--radius)] border border-line bg-canvas px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        <div className="flex items-center gap-2">
          <Badge tone="warning">1 回だけ表示</Badge>
          <Badge>{expires} まで</Badge>
        </div>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <p className="min-w-0 flex-1 select-all break-all rounded-lg bg-surface px-3 py-1.5 font-mono text-[13px] text-ink">
          {url}
        </p>
        <CopyButton value={url} />
      </div>
    </div>
  );
}
