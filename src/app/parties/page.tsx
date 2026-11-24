import Link from "next/link";
import { getRepositories } from "@/repositories";
import { formatJpDate } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/ui/icon";
import { PageHeader } from "@/components/ui/page-header";
import {
  TableCard,
  Table,
  THead,
  Th,
  TBody,
  Tr,
  Td,
} from "@/components/ui/table";
import { requirePageSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function PartiesPage() {
  await requirePageSession();
  const repos = await getRepositories();
  const parties = await repos.parties.list();

  const sorted = [...parties].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );

  const addButton = (
    <Link href="/parties/new" className={buttonVariants()}>
      <Icon name="add" className="text-[18px]" />
      新規追加
    </Link>
  );

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="取引先"
        actions={sorted.length > 0 ? addButton : undefined}
      />

      {sorted.length === 0 ? (
        <EmptyState
          icon="group"
          title="取引先がまだありません"
          action={addButton}
        />
      ) : (
        <TableCard>
          <Table>
            <THead>
              <Th>会社名・屋号</Th>
              <Th>担当者</Th>
              <Th>メール</Th>
              <Th>電話</Th>
              <Th>更新日</Th>
            </THead>
            <TBody>
              {sorted.map((party) => (
                <Tr key={party.id}>
                  <Td>
                    <Link
                      href={`/parties/${party.id}`}
                      className="font-medium text-ink hover:underline"
                    >
                      {party.name}
                    </Link>
                  </Td>
                  <Td muted>
                    {party.contactName
                      ? `${party.contactName}${party.honorific ? ` ${party.honorific}` : ""}`
                      : "—"}
                  </Td>
                  <Td muted>{party.email ?? "—"}</Td>
                  <Td muted>{party.phone ?? "—"}</Td>
                  <Td muted numeric nowrap>
                    {formatJpDate(party.updatedAt.slice(0, 10))}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </TableCard>
      )}
    </div>
  );
}
