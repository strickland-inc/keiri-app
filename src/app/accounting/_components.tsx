import type { ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Card, CardHeader } from "@/components/ui/card";
import { LinkTabs } from "@/components/ui/tabs";
import type { FiscalYear } from "@/domain/accounting";

/** 会計年度の切替（リンク）。`extra` で他のクエリを引き継ぐ。 */
export function FiscalYearTabs({
  years,
  current,
  basePath,
  extra,
}: {
  years: readonly FiscalYear[];
  current: FiscalYear;
  basePath: string;
  extra?: Record<string, string>;
}) {
  if (years.length <= 1) {
    return <span className="text-sm text-ink-muted">{current.label}</span>;
  }
  return (
    <LinkTabs
      label="会計年度"
      items={years.map((fy) => ({
        label: fy.label,
        href: `${basePath}?${new URLSearchParams({ ...extra, fy: String(fy.year) })}`,
        active: fy.year === current.year,
      }))}
    />
  );
}

/** 見出し付きの枠。表や帳票の区画に使う。 */
export function SectionCard({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
      </CardHeader>
      {children}
    </Card>
  );
}

/** 金額表示。マイナスは赤、0 はハイフン。 */
export function Amount({
  value,
  className,
}: {
  value: number;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "tabular whitespace-nowrap",
        value < 0 && "text-danger",
        className,
      )}
    >
      {value === 0 ? "—" : value.toLocaleString("ja-JP")}
    </span>
  );
}

/** 帳票の小計・合計行。strong は最終合計（太字・面を薄く塗る）。 */
export function TotalRow({
  label,
  value,
  strong,
}: {
  label: string;
  value: number;
  strong?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-4 border-t border-line-strong px-5 py-3 text-sm font-semibold text-ink",
        strong && "bg-canvas",
      )}
    >
      <span>{label}</span>
      <Amount
        value={value}
        className={strong ? "text-base font-bold" : undefined}
      />
    </div>
  );
}

/** 最終合計だけを単独で見せる枠（負債・純資産合計、当期純利益）。 */
export function GrandTotalCard({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-4 bg-canvas px-5 py-4 text-sm font-semibold text-ink">
        <span>{label}</span>
        <Amount value={value} className="text-base font-bold" />
      </div>
    </Card>
  );
}

/** 科目ごとの金額行。hrefFor があれば元帳へのリンクにする。 */
export function AccountRows({
  rows,
  hrefFor,
}: {
  rows: readonly { account: string; amount: number }[];
  /** 科目の元帳へのリンク。 */
  hrefFor?: (account: string) => string;
}) {
  if (rows.length === 0) {
    return <p className="px-5 py-4 text-sm text-ink-muted">なし</p>;
  }
  return (
    <ul className="divide-y divide-line">
      {rows.map((row) => (
        <li
          key={row.account}
          className="flex items-center justify-between gap-4 py-2.5 pl-8 pr-5 text-sm transition-colors hover:bg-canvas/70"
        >
          {hrefFor ? (
            <Link
              href={hrefFor(row.account)}
              className="text-ink hover:underline"
            >
              {row.account}
            </Link>
          ) : (
            <span className="text-ink">{row.account}</span>
          )}
          <Amount value={row.amount} />
        </li>
      ))}
    </ul>
  );
}

/** 科目を切り替える小さなピル型リンク（科目数が多い元帳用で、折り返す）。 */
export function AccountPills({
  accounts,
  current,
  hrefFor,
}: {
  accounts: readonly string[];
  current: string;
  hrefFor: (account: string) => string;
}) {
  return (
    <nav aria-label="勘定科目" className="flex flex-wrap gap-1.5">
      {accounts.map((name) => {
        const active = name === current;
        return (
          <Link
            key={name}
            href={hrefFor(name)}
            aria-current={active ? "page" : undefined}
            className={cn(
              "whitespace-nowrap rounded-full border px-3 py-1 text-[13px] transition-colors",
              active
                ? "border-ink bg-ink font-medium text-white"
                : "border-line bg-surface text-ink-muted hover:border-line-strong hover:text-ink",
            )}
          >
            {name}
          </Link>
        );
      })}
    </nav>
  );
}

/** 表の合計行（tfoot）用の class。上罫線と太字で帳票の締めを示す。 */
export const tableFootRowClass =
  "border-t border-line-strong bg-canvas/60 font-semibold";
