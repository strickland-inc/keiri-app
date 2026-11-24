import Link from "next/link";
import { getRepositories } from "@/repositories";
import { formatJpDate } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
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

export default async function IssuersPage() {
  await requirePageSession();
  const repos = await getRepositories();
  const issuers = await repos.issuers.list();

  // 既定の会社を先頭に、あとは更新が新しい順。
  const sorted = [...issuers].sort((a, b) => {
    if (a.isDefault && !b.isDefault) return -1;
    if (!a.isDefault && b.isDefault) return 1;
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });

  const addButton = (
    <Link href="/issuers/new" className={buttonVariants()}>
      <Icon name="add" className="text-[18px]" />
      新規追加
    </Link>
  );

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="会社"
        actions={sorted.length > 0 ? addButton : undefined}
      />

      {sorted.length === 0 ? (
        <EmptyState
          icon="apartment"
          title="会社がまだありません"
          action={addButton}
        />
      ) : (
        <TableCard>
          <Table>
            <THead>
              <Th>会社名・屋号</Th>
              <Th>インボイス番号</Th>
              <Th>メール</Th>
              <Th>既定</Th>
              <Th>更新日</Th>
            </THead>
            <TBody>
              {sorted.map((issuer) => (
                <Tr key={issuer.id}>
                  <Td>
                    <Link
                      href={`/issuers/${issuer.id}`}
                      className="font-medium text-ink hover:underline"
                    >
                      {issuer.name}
                    </Link>
                  </Td>
                  <Td muted numeric>
                    {issuer.registrationNumber ?? "—"}
                  </Td>
                  <Td muted>{issuer.email ?? "—"}</Td>
                  <Td muted>
                    {issuer.isDefault ? <Badge tone="brand">既定</Badge> : "—"}
                  </Td>
                  <Td muted numeric nowrap>
                    {formatJpDate(issuer.updatedAt.slice(0, 10))}
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
