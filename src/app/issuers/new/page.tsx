import { createIssuer } from "@/app/issuers/actions";
import { IssuerForm } from "@/app/issuers/issuer-form";
import { PageHeader } from "@/components/ui/page-header";

export default function NewIssuerPage() {
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="会社を追加"
        description="請求書などの差出人情報を登録します。"
      />
      <IssuerForm action={createIssuer} />
    </div>
  );
}
