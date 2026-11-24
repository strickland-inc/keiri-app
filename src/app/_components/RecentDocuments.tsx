import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/ui/icon";
import { StatusBadge } from "@/components/ui/badge";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { DOCUMENT_TYPE_LABELS, type DocumentRecord } from "@/domain/documents";
import { formatYen, summarize } from "@/domain/money";
import { formatJpDate } from "@/lib/utils";

interface RecentDocumentsProps {
  documents: readonly DocumentRecord[];
  partyNames: ReadonlyMap<string, string>;
}

/** 最近更新した書類の一覧。 */
export function RecentDocuments({
  documents,
  partyNames,
}: RecentDocumentsProps) {
  return (
    <SectionCard
      title="最近の書類"
      flush
      action={
        <Link
          href="/documents"
          className="text-[13px] text-ink-muted hover:text-ink"
        >
          すべて見る
        </Link>
      }
    >
      {documents.length === 0 ? (
        <div className="p-5">
          <EmptyState
            icon="description"
            title="書類がまだありません"
            action={
              <Link
                href="/documents/new"
                className={buttonVariants({ size: "sm" })}
              >
                <Icon name="add" className="text-[16px]" />
                書類を作成
              </Link>
            }
          />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <THead>
              <Th>番号</Th>
              <Th>種類</Th>
              <Th>取引先</Th>
              <Th align="right">金額</Th>
              <Th>状態</Th>
              <Th>発行日</Th>
            </THead>
            <TBody>
              {documents.map((doc) => (
                <Tr key={doc.id}>
                  <Td nowrap>
                    <Link
                      href={`/documents/${doc.id}`}
                      className="font-medium hover:underline"
                    >
                      {doc.number || "—"}
                    </Link>
                  </Td>
                  <Td muted nowrap>
                    {DOCUMENT_TYPE_LABELS[doc.type]}
                  </Td>
                  <Td nowrap>{partyNames.get(doc.partyId) ?? "—"}</Td>
                  <Td align="right" numeric nowrap>
                    {formatYen(summarize(doc.items).total)}
                  </Td>
                  <Td nowrap>
                    <StatusBadge status={doc.status} />
                  </Td>
                  <Td muted numeric nowrap>
                    {formatJpDate(doc.issueDate)}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </div>
      )}
    </SectionCard>
  );
}
