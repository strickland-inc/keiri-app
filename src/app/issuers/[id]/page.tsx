import { notFound } from "next/navigation";
import { getRepositories } from "@/repositories";
import { updateIssuer } from "@/app/issuers/actions";
import { IssuerForm } from "@/app/issuers/issuer-form";
import { PageHeader } from "@/components/ui/page-header";
import { DeleteIssuerButton } from "./delete-button";

export const dynamic = "force-dynamic";

export default async function EditIssuerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const repos = await getRepositories();
  const issuer = await repos.issuers.get(id);
  if (!issuer) notFound();

  const boundAction = updateIssuer.bind(null, id);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="会社を編集"
        description={issuer.name}
        actions={<DeleteIssuerButton id={id} />}
      />

      <IssuerForm action={boundAction} defaultValues={issuer} />
    </div>
  );
}
