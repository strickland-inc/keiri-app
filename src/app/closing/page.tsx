import type { ReactElement } from "react";
import Link from "next/link";
import { getRepositories } from "@/repositories";
import { loadCompanyContext } from "@/lib/active-company";
import { hasFiscalSettings, listFiscalYears } from "@/domain/fiscal-year";
import {
  defaultClosingTerm,
  isValidClosingTerm,
  loadClosing,
} from "@/lib/closing/load-closing";
import { formatYen } from "@/domain/money";
import { formatJpDate } from "@/lib/utils";
import { firstParam, type SearchParamValue } from "@/lib/search-params";
import { Icon } from "@/components/ui/icon";
import { Alert } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { Card, SectionCard } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Stat } from "@/components/ui/stat";
import { LinkTabs } from "@/components/ui/tabs";
import {
  Table,
  TableCard,
  TBody,
  Td,
  Th,
  THead,
  Tr,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { requirePageSession } from "@/lib/session";

export const dynamic = "force-dynamic";

function monthLabel(month: string): string {
  const [y, m] = month.split("-");
  return `${y}/${Number(m)}`;
}

export default async function ClosingPage({
  searchParams,
}: {
  searchParams: Promise<{ term?: SearchParamValue }>;
}): Promise<ReactElement> {
  await requirePageSession();
  const today = new Date();
  const repos = await getRepositories();
  const company = await loadCompanyContext(repos);
  const activeIssuer = company.active;

  if (!activeIssuer || !hasFiscalSettings(activeIssuer)) {
    return (
      <div className="flex flex-col gap-8">
        <PageHeader title="決算" />
        <EmptyState
          icon="inventory_2"
          title="決算月と第1期の期末日が未設定です"
          action={
            activeIssuer && (
              <Link
                href={`/issuers/${activeIssuer.id}`}
                className={buttonVariants({ variant: "secondary" })}
              >
                会社の設定へ
              </Link>
            )
          }
        />
      </div>
    );
  }

  const sp = await searchParams;
  const requestedTerm = Number(firstParam(sp.term));
  const term = isValidClosingTerm(requestedTerm)
    ? requestedTerm
    : defaultClosingTerm(activeIssuer, today);

  const loaded = await loadClosing(repos, company, term);
  if (!loaded) {
    return (
      <div className="flex flex-col gap-8">
        <PageHeader title="決算" />
        <Alert tone="danger">この期の集計を読み込めませんでした。</Alert>
      </div>
    );
  }

  const { report, fiscalYear: fy } = loaded;
  const years = listFiscalYears(activeIssuer, today);
  const pendingLink =
    "/expenses?period=all&category=" + encodeURIComponent("要確認");

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="決算"
        actions={
          <>
            <span className="text-sm text-ink-muted">{fy.label}</span>
            <LinkTabs
              label="期"
              items={years.map((y) => ({
                label: `第${y.term}期`,
                href: `/closing?term=${y.term}`,
                active: y.term === term,
              }))}
            />
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="売上高" value={formatYen(report.revenue.total)} />
        <Stat
          label="販売費及び一般管理費"
          value={formatYen(report.sga.total)}
        />
        <Stat
          label="営業利益"
          value={formatYen(report.operatingIncome)}
          tone={report.operatingIncome < 0 ? "negative" : "default"}
        />
      </div>

      {report.pending.count > 0 && (
        <Link
          href={pendingLink}
          className="block transition-opacity hover:opacity-80"
        >
          <Alert tone="warning">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="font-semibold">未確定の経費</p>
              <p className="text-lg font-semibold tabular text-warning">
                {formatYen(report.pending.total)}（{report.pending.count}件）
              </p>
            </div>
          </Alert>
        </Link>
      )}

      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold">月別カバレッジ</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          {report.coverage.map((c) => {
            const isGap = c.count === 0;
            return (
              <Card
                key={c.month}
                className={cn("p-3", isGap && "border-warning/30 bg-warning/5")}
              >
                <p className="text-xs text-ink-muted">{monthLabel(c.month)}</p>
                {isGap ? (
                  <p className="mt-1 text-sm font-semibold text-warning">
                    明細なし
                  </p>
                ) : (
                  <>
                    <p className="mt-1 text-sm font-semibold tabular">
                      {formatYen(c.amount)}
                    </p>
                    <p className="text-xs tabular text-ink-muted">
                      {c.count}件
                    </p>
                  </>
                )}
              </Card>
            );
          })}
        </div>
      </section>

      <SectionCard title="販売費及び一般管理費内訳書" flush>
        <div className="overflow-x-auto">
          <Table>
            <THead>
              <Th>科目</Th>
              <Th align="right">金額</Th>
              <Th align="right">件数</Th>
            </THead>
            <TBody>
              {report.sga.byCategory
                .filter((c) => c.amount > 0)
                .map((c) => (
                  <Tr key={c.category}>
                    <Td>{c.category}</Td>
                    <Td align="right" numeric>
                      {formatYen(c.amount)}
                    </Td>
                    <Td align="right" numeric muted>
                      {c.count}件
                    </Td>
                  </Tr>
                ))}
              <Tr className="font-semibold">
                <Td>計</Td>
                <Td align="right" numeric>
                  {formatYen(report.sga.total)}
                </Td>
                <Td />
              </Tr>
            </TBody>
          </Table>
        </div>
      </SectionCard>

      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold">売上明細</h2>
        {report.revenue.lines.length === 0 ? (
          <EmptyState icon="payments" title="この期の売上明細はありません" />
        ) : (
          <TableCard>
            <Table>
              <THead>
                <Th>日付</Th>
                <Th>取引先</Th>
                <Th>摘要</Th>
                <Th align="right">金額</Th>
                <Th>出所</Th>
              </THead>
              <TBody>
                {report.revenue.lines.map((l, i) => (
                  <Tr key={`${l.date}-${i}`}>
                    <Td muted numeric nowrap>
                      {formatJpDate(l.date)}
                    </Td>
                    <Td className="max-w-xs truncate">{l.partyName}</Td>
                    <Td muted className="max-w-xs truncate">
                      {l.description}
                    </Td>
                    <Td align="right" numeric className="font-medium">
                      {formatYen(l.amount)}
                    </Td>
                    <Td muted className="text-xs">
                      {l.source}
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </TableCard>
        )}
      </section>

      {report.pending.count > 0 && (
        <SectionCard
          title="要確認一覧"
          flush
          action={
            <Link
              href={pendingLink}
              className={buttonVariants({ variant: "ghost", size: "sm" })}
            >
              経費で確認する
            </Link>
          }
        >
          <div className="overflow-x-auto">
            <Table>
              <THead>
                <Th>日付</Th>
                <Th>店名</Th>
                <Th align="right">金額</Th>
              </THead>
              <TBody>
                {report.pending.items.map((e) => (
                  <Tr key={e.id}>
                    <Td muted numeric nowrap>
                      {formatJpDate(e.date)}
                    </Td>
                    <Td className="max-w-xs truncate">{e.merchant}</Td>
                    <Td align="right" numeric className="font-medium">
                      {formatYen(e.amount)}
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </div>
        </SectionCard>
      )}

      <SectionCard title="ダウンロード">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <a
              href={`/api/closing/freee-csv?term=${term}&kind=expenses`}
              download
              className={buttonVariants({ variant: "secondary", size: "sm" })}
            >
              <Icon name="download" className="text-[16px]" />
              freee 取込 CSV（経費）
            </a>
            <a
              href={`/api/closing/freee-csv?term=${term}&kind=revenues`}
              download
              className={buttonVariants({ variant: "secondary", size: "sm" })}
            >
              <Icon name="download" className="text-[16px]" />
              freee 取込 CSV（売上）
            </a>
            <a
              href={`/api/closing/trial-balance?term=${term}`}
              download
              className={buttonVariants({ variant: "secondary", size: "sm" })}
            >
              <Icon name="download" className="text-[16px]" />
              試算表 CSV
            </a>
          </div>
        </div>
      </SectionCard>
    </div>
  );
}
