import { createParty } from "@/app/parties/actions";
import { PartyForm } from "@/app/parties/party-form";
import { PageHeader } from "@/components/ui/page-header";
import { requirePageSession } from "@/lib/session";

export default async function NewPartyPage() {
  await requirePageSession();
  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="取引先を追加" />
      <PartyForm action={createParty} />
    </div>
  );
}
