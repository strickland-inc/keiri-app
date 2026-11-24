import Link from "next/link";
import { getRepositories } from "@/repositories";
import { RECEIVABLE, accountsFor, type ClassifyMethod } from "@/domain/bank";
import { cn, formatJpDate } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page-header";
import { Icon } from "@/components/ui/icon";
import { Stat } from "@/components/ui/stat";
import { LinkTabs } from "@/components/ui/tabs";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Table,
  TableCard,
  TBody,
  Td,
  Th,
  THead,
  Tr,
} from "@/components/ui/table";
import { BankImport } from "./bank-import";
import { AccountSelect, RowButtons } from "./row-actions";
import { requirePageSession } from "@/lib/session";

export const dynamic = "force-dynamic";

const MAX_ROWS = 300;

const METHOD_LABELS: Record<ClassifyMethod, string> = {
  match: "請求書と照合",
  rule: "過去の判断",
  jev: "Jev",
  manual: "手動",
  fallback: "判断できず",
};

function yen(n: number): string {
  return n.toLocaleString("ja-JP");
}

export default async function BankPage({
  searchParams,
}: {
  searchParams: Promise<{ review?: string }>;
}) {
  await requirePageSession();
  const { review } = await searchParams;
  const reviewOnly = review === "1";

  const repos = await getRepositories();
  const [all, invoices] = await Promise.all([
    repos.bankTransactions.list(),
    repos.documents.list({ type: "invoice" }),
  ]);
  const invoiceNumbers = new Map(invoices.map((d) => [d.id, d.number]));

  const reviewCount = all.filter((t) => t.needsReview).length;
  const inflow = all
    .filter((t) => t.amount > 0)
    .reduce((s, t) => s + t.amount, 0);
  const outflow = all
    .filter((t) => t.amount < 0)
    .reduce((s, t) => s - t.amount, 0);
  const shown = (reviewOnly ? all.filter((t) => t.needsReview) : all).slice(
    0,
    MAX_ROWS,
  );

  const tabs = [
    { label: "すべて", href: "/bank", active: !reviewOnly },
    {
      label: `要確認 ${reviewCount}`,
      href: "/bank?review=1",
      active: reviewOnly,
    },
  ];

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="銀行明細" />

      <BankImport />

      {all.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-3">
          <Stat label="入金合計" value={`${yen(inflow)} 円`} />
          <Stat label="出金合計" value={`${yen(outflow)} 円`} />
          <Stat
            label="要確認"
            value={`${reviewCount} 件`}
            tone={reviewCount > 0 ? "warning" : "default"}
          />
        </div>
      )}

      <LinkTabs items={tabs} label="表示の絞り込み" />

      {shown.length === 0 ? (
        <EmptyState
          icon="account_balance"
          title={
            reviewOnly
              ? "要確認の取引はありません"
              : "まだ明細を取り込んでいません"
          }
        />
      ) : (
        <TableCard>
          <Table>
            <THead>
              <Th>日付</Th>
              <Th>摘要</Th>
              <Th align="right">入金</Th>
              <Th align="right">出金</Th>
              <Th>勘定科目</Th>
              <Th>判断</Th>
              <Th />
            </THead>
            <TBody>
              {shown.map((tx) => (
                <Tr
                  key={tx.id}
                  className={cn(tx.needsReview && "bg-warning/5")}
                >
                  <Td nowrap numeric muted>
                    {formatJpDate(tx.date)}
                  </Td>
                  <Td className="max-w-xs">
                    <span className="line-clamp-2">
                      {tx.description || "—"}
                    </span>
                  </Td>
                  <Td align="right" nowrap numeric>
                    {tx.amount > 0 ? yen(tx.amount) : ""}
                  </Td>
                  <Td align="right" nowrap numeric>
                    {tx.amount < 0 ? yen(-tx.amount) : ""}
                  </Td>
                  <Td>
                    <AccountSelect
                      id={tx.id}
                      account={tx.account}
                      options={accountsFor(tx.amount).filter(
                        (a) =>
                          a !== RECEIVABLE ||
                          tx.matchedDocumentId !== undefined,
                      )}
                    />
                  </Td>
                  <Td nowrap muted className="text-xs">
                    {tx.needsReview && (
                      <span className="mr-1.5 inline-flex items-center gap-0.5 font-medium text-warning">
                        <Icon name="flag" className="text-[14px]" />
                        要確認
                      </span>
                    )}
                    {tx.matchedDocumentId ? (
                      <Link
                        href={`/documents/${tx.matchedDocumentId}`}
                        className="text-ink underline-offset-2 hover:underline"
                      >
                        請求書 {invoiceNumbers.get(tx.matchedDocumentId) ?? ""}
                      </Link>
                    ) : (
                      METHOD_LABELS[tx.method]
                    )}
                  </Td>
                  <Td>
                    <RowButtons id={tx.id} needsReview={tx.needsReview} />
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
          {(reviewOnly ? reviewCount : all.length) > MAX_ROWS && (
            <p className="border-t border-line px-4 py-3 text-xs text-ink-muted">
              <span className="tabular">
                {MAX_ROWS} / {reviewOnly ? reviewCount : all.length} 件
              </span>
            </p>
          )}
        </TableCard>
      )}
    </div>
  );
}
