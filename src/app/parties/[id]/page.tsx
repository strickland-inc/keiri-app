import { notFound } from "next/navigation";
import { getRepositories } from "@/repositories";
import { updateParty } from "@/app/parties/actions";
import { PartyForm } from "@/app/parties/party-form";
import { PageHeader } from "@/components/ui/page-header";
import { DeletePartyButton } from "./delete-button";
import { requirePageSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function EditPartyPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePageSession();
  const { id } = await params;
  const repos = await getRepositories();
  const party = await repos.parties.get(id);
  if (!party) notFound();

  const boundAction = updateParty.bind(null, id);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="取引先を編集"
        actions={<DeletePartyButton id={id} />}
      />

      <PartyForm action={boundAction} defaultValues={party} />
    </div>
  );
}
