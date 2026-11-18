import { getRepositories } from "@/repositories";
import { createDocument } from "@/app/documents/actions";
import {
  buildCopyDraft,
  DOCUMENT_TYPE_LABELS,
  isDocumentType,
} from "@/domain/documents";
import { todayIso } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page-header";
import { loadCompanyContext } from "@/lib/active-company";
import { DocumentForm } from "./document-form";

export const dynamic = "force-dynamic";

export default async function NewDocumentPage({
  searchParams,
}: {
  searchParams: Promise<{ copyFrom?: string; type?: string }>;
}) {
  const { copyFrom, type } = await searchParams;
  const repos = await getRepositories();
  const [parties, company, source] = await Promise.all([
    repos.parties.list(),
    loadCompanyContext(repos),
    copyFrom ? repos.documents.get(copyFrom) : Promise.resolve(null),
  ]);

  const draft = source ? buildCopyDraft(source, todayIso()) : undefined;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={draft ? "書類をコピーして作成" : "書類を作成"}
        description={
          source
            ? `${DOCUMENT_TYPE_LABELS[source.type]} ${source.number} の内容をコピーしました。発行日は今日になっています。必要な箇所を直して保存してください。`
            : "書類の種類・取引先・明細を入力してください。"
        }
      />

      <DocumentForm
        parties={parties}
        company={company.active}
        action={createDocument}
        defaultValues={draft}
        initialType={type && isDocumentType(type) ? type : undefined}
      />
    </div>
  );
}
