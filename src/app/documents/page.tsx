import Link from "next/link";
import { getRepositories } from "@/repositories";
import { companyScope, loadCompanyContext } from "@/lib/active-company";
import {
  DOCUMENT_TYPES,
  DOCUMENT_TYPE_LABELS,
  isDocumentType,
  type DocumentRecord,
  type DocumentType,
} from "@/domain/documents";
import { summarize, formatYen } from "@/domain/money";
import { formatJpDate } from "@/lib/utils";
import { StatusBadge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/ui/icon";
import { LinkTabs, type TabItem } from "@/components/ui/tabs";
import { PageHeader } from "@/components/ui/page-header";
import {
  Table,
  TableCard,
  TBody,
  Td,
  Th,
  THead,
  Tr,
} from "@/components/ui/table";
import { requirePageSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/** status=unpaid は「入金待ち」（請求書の発行済・送付済）。 */
const UNPAID_STATUSES = ["issued", "sent"];

export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; status?: string }>;
}) {
  await requirePageSession();
  const sp = await searchParams;
  const activeType: DocumentType | undefined =
    sp.type && isDocumentType(sp.type) ? sp.type : undefined;
  const unpaidOnly = sp.status === "unpaid";

  const repos = await getRepositories();
  const documentScope = companyScope(await loadCompanyContext(repos));
  const [allDocs, parties] = await Promise.all([
    repos.documents.list(
      unpaidOnly
        ? { ...documentScope, type: "invoice" }
        : activeType
          ? { ...documentScope, type: activeType }
          : documentScope,
    ),
    repos.parties.list(),
  ]);

  const partyNames = new Map(parties.map((p) => [p.id, p.name]));
  const docs = allDocs
    .filter((d) => !unpaidOnly || UNPAID_STATUSES.includes(d.status))
    .sort((a, b) => b.issueDate.localeCompare(a.issueDate));

  const tabs: TabItem[] = [
    { label: "すべて", href: "/documents", active: !activeType && !unpaidOnly },
    ...DOCUMENT_TYPES.map((t) => ({
      label: DOCUMENT_TYPE_LABELS[t],
      href: `/documents?type=${t}`,
      active: !unpaidOnly && t === activeType,
    })),
    { label: "入金待ち", href: "/documents?status=unpaid", active: unpaidOnly },
  ];

  const title = unpaidOnly
    ? "入金待ちの請求書"
    : activeType
      ? DOCUMENT_TYPE_LABELS[activeType]
      : "すべての書類";

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={title}
        actions={
          <Link
            href={
              activeType
                ? `/documents/new?type=${activeType}`
                : "/documents/new"
            }
            className={buttonVariants({ variant: "primary" })}
          >
            <Icon name="add" className="text-[18px]" />
            新規作成
          </Link>
        }
      />

      <LinkTabs items={tabs} label="書類の絞り込み" />

      {docs.length === 0 ? (
        <EmptyState icon="description" title="該当する書類がありません" />
      ) : (
        <TableCard>
          <Table>
            <THead>
              <Th>番号</Th>
              <Th>発行日</Th>
              <Th>取引先</Th>
              <Th>件名</Th>
              <Th align="right">税込金額</Th>
              <Th>状態</Th>
              <Th />
            </THead>
            <TBody>
              {docs.map((doc) => (
                <DocumentRow
                  key={doc.id}
                  doc={doc}
                  partyName={partyNames.get(doc.partyId)}
                />
              ))}
            </TBody>
          </Table>
        </TableCard>
      )}
    </div>
  );
}

function DocumentRow({
  doc,
  partyName,
}: {
  doc: DocumentRecord;
  partyName?: string;
}) {
  return (
    <Tr>
      <Td nowrap>
        <Link
          href={`/documents/${doc.id}`}
          className="font-medium text-ink underline-offset-4 hover:underline"
        >
          {doc.number || "—"}
        </Link>
        <span className="ml-2 text-xs text-ink-muted">
          {DOCUMENT_TYPE_LABELS[doc.type]}
        </span>
      </Td>
      <Td nowrap numeric muted>
        {formatJpDate(doc.issueDate)}
      </Td>
      <Td nowrap>{partyName ?? "—"}</Td>
      <Td className="max-w-xs truncate">{doc.title}</Td>
      <Td nowrap numeric align="right" className="font-medium">
        {formatYen(summarize(doc.items).total)}
      </Td>
      <Td nowrap>
        <StatusBadge status={doc.status} />
      </Td>
      <Td nowrap align="right">
        <div className="flex items-center justify-end gap-1">
          <Link
            href={`/documents/new?copyFrom=${doc.id}`}
            className={buttonVariants({ variant: "ghost", size: "sm" })}
            title="この書類をコピーして新規作成"
          >
            <Icon name="content_copy" className="text-[16px]" />
            コピー
          </Link>
          {doc.sheetUrl && (
            <a
              href={doc.sheetUrl}
              target="_blank"
              rel="noreferrer"
              className={buttonVariants({ variant: "ghost", size: "sm" })}
              title="スプレッドシートを開く"
            >
              <Icon name="open_in_new" className="text-[16px]" />
              シート
            </a>
          )}
        </div>
      </Td>
    </Tr>
  );
}
