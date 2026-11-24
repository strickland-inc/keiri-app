import { getRepositories } from "@/repositories";
import { createDocument } from "@/app/documents/actions";
import { buildCopyDraft, isDocumentType } from "@/domain/documents";
import { todayIso } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page-header";
import { loadCompanyContext } from "@/lib/active-company";
import { DocumentForm } from "./document-form";
import { requirePageSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function NewDocumentPage({
  searchParams,
}: {
  searchParams: Promise<{ copyFrom?: string; type?: string }>;
}) {
  await requirePageSession();
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
      <PageHeader title={draft ? "書類をコピーして作成" : "書類を作成"} />

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
