import { redirect } from "next/navigation";
import { ROLE_LABELS } from "@/domain/user";
import { listAudit } from "@/lib/audit";
import { listInvites, listUsers } from "@/lib/auth-server";
import { requirePageSession } from "@/lib/session";
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
import { formatDateTime } from "./format";
import { InviteForm } from "./invite-form";
import { RevokeInviteButton } from "./revoke-invite-button";
import { UserRow } from "./user-row";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const session = await requirePageSession();
  if (session.role !== "admin") redirect("/");

  const [users, invites, logins] = await Promise.all([
    listUsers(),
    listInvites(),
    // 最終ログインは users に無い。ログイン成功の記録から人ごとの最新を拾う（新しい順なので最初の 1 件）
    listAudit({ action: "login.success" }),
  ]);

  const lastLogin = new Map<string, string>();
  for (const entry of logins) {
    if (entry.actorType === "user" && !lastLogin.has(entry.actorId)) {
      lastLogin.set(entry.actorId, entry.at);
    }
  }
  const activeAdmins = users.filter(
    (u) => u.role === "admin" && u.status === "active",
  );
  const pending = invites.filter((i) => i.status === "pending");

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="ユーザー管理" />

      <InviteForm />

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-ink">
          ユーザー {users.length} 人
        </h2>
        <TableCard>
          <Table>
            <THead>
              <Th>ユーザー</Th>
              <Th>役割</Th>
              <Th>状態</Th>
              <Th>2段階認証</Th>
              <Th>最終ログイン</Th>
            </THead>
            <TBody>
              {users.map((u) => (
                <UserRow
                  key={u.id}
                  user={{
                    id: u.id,
                    loginId: u.loginId,
                    displayName: u.displayName,
                    role: u.role,
                    status: u.status,
                    totpEnabled: u.totpEnabled,
                    lastLogin: formatDateTime(lastLogin.get(u.id) ?? ""),
                    isSelf: u.id === session.sub,
                    isLastAdmin:
                      activeAdmins.length === 1 && activeAdmins[0].id === u.id,
                  }}
                />
              ))}
            </TBody>
          </Table>
        </TableCard>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-ink">
          未使用のリンク {pending.length} 件
        </h2>
        {pending.length === 0 ? (
          <EmptyState icon="key" title="使われていないリンクはありません" />
        ) : (
          <TableCard>
            <Table>
              <THead>
                <Th>種類</Th>
                <Th>内容</Th>
                <Th>作った日時</Th>
                <Th>期限</Th>
                <Th />
              </THead>
              <TBody>
                {pending.map((i) => (
                  <Tr key={i.id}>
                    <Td>
                      <Badge tone={i.kind === "invite" ? "brand" : "neutral"}>
                        {i.kind === "invite" ? "招待" : "再設定"}
                      </Badge>
                    </Td>
                    <Td>
                      {i.kind === "invite"
                        ? `${ROLE_LABELS[i.role]}${i.note ? `、${i.note}` : ""}`
                        : `${i.note} のパスワード再設定`}
                    </Td>
                    <Td muted nowrap>
                      {formatDateTime(i.createdAt)}
                    </Td>
                    <Td muted nowrap>
                      {formatDateTime(i.expiresAt)}
                    </Td>
                    <Td align="right">
                      <RevokeInviteButton id={i.id} />
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
