import { createIssuer } from "@/app/issuers/actions";
import { IssuerForm } from "@/app/issuers/issuer-form";
import { PageHeader } from "@/components/ui/page-header";
import { requirePageSession } from "@/lib/session";

export default async function NewIssuerPage() {
  await requirePageSession();
  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="会社を追加" />
      <IssuerForm action={createIssuer} />
    </div>
  );
}
