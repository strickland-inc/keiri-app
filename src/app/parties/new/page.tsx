import { createParty } from "@/app/parties/actions";
import { PartyForm } from "@/app/parties/party-form";
import { PageHeader } from "@/components/ui/page-header";

export default function NewPartyPage() {
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="取引先を追加"
        description="書類の宛先として使用する取引先情報を登録します。"
      />
      <PartyForm action={createParty} />
    </div>
  );
}
