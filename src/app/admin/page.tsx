import { getRepositories } from "@/repositories";
import { formatJpDate } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
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
import { CreateUserForm } from "./create-user-form";
import { DeleteUserButton } from "./delete-user-button";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const repos = await getRepositories();
  const users = await repos.users.list();
  const sorted = [...users].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="管理者ページ"
        description="ログインユーザーの発行・管理を行います。"
      />

      <CreateUserForm />

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-ink">
          発行済みユーザー（{sorted.length}）
        </h2>
        {sorted.length === 0 ? (
          <EmptyState
            icon="group"
            title="まだ発行したユーザーはいません"
            description="環境変数で設定した管理者アカウントはここには表示されません。"
          />
        ) : (
          <TableCard>
            <Table>
              <THead>
                <Th>ログインID</Th>
                <Th>権限</Th>
                <Th>作成日</Th>
                <Th />
              </THead>
              <TBody>
                {sorted.map((u) => (
                  <Tr key={u.id}>
                    <Td className="font-mono">{u.loginId}</Td>
                    <Td>
                      <Badge tone={u.role === "admin" ? "brand" : "neutral"}>
                        {u.role === "admin" ? "管理者" : "一般"}
                      </Badge>
                    </Td>
                    <Td muted numeric nowrap>
                      {formatJpDate(u.createdAt.slice(0, 10))}
                    </Td>
                    <Td align="right">
                      <DeleteUserButton id={u.id} />
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </TableCard>
        )}
      </section>
    </div>
  );
}
