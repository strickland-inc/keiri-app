"use client";

import { useRef, useTransition } from "react";
import type { Issuer } from "@/domain/issuer";
import { switchCompany } from "@/app/_actions/company";
import { Icon } from "@/components/ui/icon";
import { controlClass } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface CompanySwitcherProps {
  companies: Issuer[];
  activeId: string | null;
  className?: string;
}

/**
 * 見ている会社の切替。帳票・経費・レポート・ダッシュボードがまとめて切り替わる。
 * 会社が1社しか無いときは選ばせず、今の会社名だけを見出しとして出す。
 */
export function CompanySwitcher({
  companies,
  activeId,
  className,
}: CompanySwitcherProps): React.ReactElement | null {
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();

  if (companies.length === 0) return null;

  const active = companies.find((c) => c.id === activeId) ?? companies[0];

  if (companies.length === 1) {
    return (
      <div className={cn("flex items-center gap-2 px-3 text-sm", className)}>
        <Icon name="apartment" className="text-[18px] text-ink-faint" />
        <span className="truncate font-medium text-ink">{active.name}</span>
      </div>
    );
  }

  return (
    <form
      ref={formRef}
      action={switchCompany}
      className={cn("relative", className)}
    >
      <Icon
        name="apartment"
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-ink-faint"
      />
      <select
        name="companyId"
        aria-label="表示する会社"
        defaultValue={active.id}
        disabled={pending}
        onChange={() => startTransition(() => formRef.current?.requestSubmit())}
        className={cn(
          controlClass,
          "h-10 appearance-none truncate pl-9 pr-9 font-medium",
        )}
      >
        {companies.map((company) => (
          <option key={company.id} value={company.id}>
            {company.name}
          </option>
        ))}
      </select>
      <Icon
        name="expand_more"
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[18px] text-ink-faint"
      />
      {/* JS 無効時でも切り替えられるようにする。 */}
      <noscript>
        <button
          type="submit"
          className="mt-1 w-full rounded-[var(--radius)] border border-line-strong px-2 py-1 text-xs"
        >
          切り替える
        </button>
      </noscript>
    </form>
  );
}
