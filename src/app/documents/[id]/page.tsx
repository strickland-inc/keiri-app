import Link from "next/link";
import { notFound } from "next/navigation";
import { getRepositories } from "@/repositories";
import { DOCUMENT_TYPE_LABELS } from "@/domain/documents";
import { summarize, formatYen } from "@/domain/money";
import { StatusBadge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { PageHeader } from "@/components/ui/page-header";
import { buildDocumentPdfFilename } from "@/lib/documents/pdfFilename";
import { DeleteDocumentButton } from "./delete-button";
import { DocumentPreview } from "./document-preview";
import { buildMessageTexts, deadlineLine } from "./message-texts";
import { MessageCopyPanel } from "./message-copy-panel";
import { PdfDownloadButton } from "./pdf-download-button";
import { StatusActions } from "./status-actions";

export const dynamic = "force-dynamic";

export default async function DocumentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const repos = await getRepositories();
  const doc = await repos.documents.get(id);
  if (!doc) notFound();

  const [party, issuer] = await Promise.all([
    repos.parties.get(doc.partyId),
    repos.issuers.get(doc.issuerId),
  ]);

  const summary = summarize(doc.items);
  const typeLabel = DOCUMENT_TYPE_LABELS[doc.type];
  const pdfFilename = party
    ? buildDocumentPdfFilename({ doc, party })
    : `${typeLabel}_${doc.number}.pdf`;
  const messageTexts = buildMessageTexts({
    typeLabel,
    issuerName: issuer?.name,
    partyName: party?.name,
    title: doc.title,
    number: doc.number,
    totalText: `${formatYen(summary.total)}（税込）`,
    deadline: deadlineLine(doc),
    filename: pdfFilename,
  });

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={doc.number || "（番号なし）"}
        description={`${typeLabel} ・ ${doc.title}`}
        actions={
          <>
            <StatusBadge status={doc.status} />
            <StatusActions id={doc.id} currentStatus={doc.status} />
            <Link
              href={`/documents/new?copyFrom=${doc.id}`}
              className={buttonVariants({ variant: "secondary", size: "sm" })}
            >
              <Icon name="content_copy" className="text-[16px]" />
              コピーして作成
            </Link>
            {doc.sheetUrl && (
              <a
                href={doc.sheetUrl}
                target="_blank"
                rel="noreferrer"
                className={buttonVariants({ variant: "secondary", size: "sm" })}
              >
                <Icon name="open_in_new" className="text-[16px]" />
                スプレッドシート
              </a>
            )}
            <PdfDownloadButton
              doc={doc}
              issuer={issuer}
              party={party}
              filename={pdfFilename}
              useSheetExport={Boolean(
                doc.generatedSpreadsheetId && doc.generatedSheetId,
              )}
            />
            <Link
              href={`/documents/${doc.id}/edit`}
              className={buttonVariants({ variant: "secondary", size: "sm" })}
            >
              <Icon name="edit" className="text-[16px]" />
              編集
            </Link>
            <DeleteDocumentButton id={doc.id} />
          </>
        }
      />

      <DocumentPreview doc={doc} party={party} issuer={issuer} />

      <MessageCopyPanel {...messageTexts} />

      <div className="flex flex-col gap-0.5 text-xs text-ink-muted">
        {doc.generatedSheetName && <p>シート: {doc.generatedSheetName}</p>}
        <p>作成: {new Date(doc.createdAt).toLocaleString("ja-JP")}</p>
        <p>更新: {new Date(doc.updatedAt).toLocaleString("ja-JP")}</p>
      </div>
    </div>
  );
}
