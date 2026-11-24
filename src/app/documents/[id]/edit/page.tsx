import { notFound } from "next/navigation";
import { getRepositories } from "@/repositories";
import { updateDocument } from "@/app/documents/actions";
import { PageHeader } from "@/components/ui/page-header";
import { loadCompanyContext } from "@/lib/active-company";
import { DocumentForm } from "@/app/documents/new/document-form";
import { requirePageSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function EditDocumentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePageSession();
  const { id } = await params;
  const repos = await getRepositories();
  const [doc, parties, company] = await Promise.all([
    repos.documents.get(id),
    repos.parties.list(),
    loadCompanyContext(repos),
  ]);

  if (!doc) notFound();

  // 編集画面では、帳票が既に属している会社をそのまま出す。
  const issuer =
    company.companies.find((c) => c.id === doc.issuerId) ?? company.active;

  const boundAction = updateDocument.bind(null, id);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title={`書類を編集 ${doc.number}`} />

      <DocumentForm
        parties={parties}
        company={issuer}
        action={boundAction}
        defaultValues={doc}
      />
    </div>
  );
}
