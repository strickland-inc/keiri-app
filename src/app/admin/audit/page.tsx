import { redirect } from "next/navigation";
import type { AuditEntry } from "@/domain/audit";
import { ROLE_LABELS } from "@/domain/user";
import { listAudit } from "@/lib/audit";
import { listUsers } from "@/lib/auth-server";
import { requirePageSession } from "@/lib/session";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { LinkTabs } from "@/components/ui/tabs";
import {
  TableCard,
  Table,
  THead,
  Th,
  TBody,
  Tr,
  Td,
} from "@/components/ui/table";
import { formatDateTime } from "../format";
import {
  AUDIT_KIND_LABELS,
  auditKindOf,
  auditLabel,
  type AuditKind,
} from "./labels";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ kind?: string; actor?: string }>;

function parseKind(value: string | undefined): AuditKind | "all" {
  return value === "auth" || value === "admin" || value === "data"
    ? value
    : "all";
}

function href(kind: AuditKind | "all", actor: string): string {
  const q = new URLSearchParams();
  if (kind !== "all") q.set("kind", kind);
  if (actor) q.set("actor", actor);
  const s = q.toString();
  return s ? `/admin/audit?${s}` : "/admin/audit";
}

/**
 * 「内容」の列に出す文字。UUID は出さない。
 * 対象がユーザーなら、いま居る人に限りログイン ID を足す（消された人は、記録時の summary に ID が入っている）。
 * 本人の操作と、書類や経費など summary が説明している対象には、対象を足さない。
 */
function auditDetail(
  e: AuditEntry,
  loginIdOf: ReadonlyMap<string, string>,
): string {
  // 以前の記録は役割を保存値（admin、user）のまま持つので、呼び名に直す
  const roleOf = (v: string) => ROLE_LABELS[v as keyof typeof ROLE_LABELS];
  const summary = e.summary
    .replace(
      /役割: (admin|user)(?=、|$)/,
      (_m, v: string) => `役割: ${roleOf(v)}`,
    )
    .replace(
      /: (admin|user) → (admin|user)$/,
      (_m, x: string, y: string) => `: ${roleOf(x)} → ${roleOf(y)}`,
    );
  const parts = summary ? [summary] : [];
  if (e.targetType === "user" && e.targetId && e.targetId !== e.actorId) {
    const loginId = loginIdOf.get(e.targetId);
    if (loginId && !summary.includes(loginId)) parts.push(`対象 ${loginId}`);
  }
  return parts.join("、");
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await requirePageSession();
  if (session.role !== "admin") redirect("/");

  const params = await searchParams;
  const kind = parseKind(params.kind);
  const actor = typeof params.actor === "string" ? params.actor : "";

  const [users, all] = await Promise.all([
    listUsers(),
    listAudit(actor ? { actorId: actor } : undefined),
  ]);
  const loginIdOf = new Map(users.map((u) => [u.id, u.loginId]));
  // 種類での絞り込みは、取った 500 件の中で行う
  const entries =
    kind === "all" ? all : all.filter((e) => auditKindOf(e.action) === kind);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="監査ログ" />

      <div className="flex flex-wrap items-end justify-between gap-4">
        <LinkTabs
          label="操作の種類"
          items={[
            {
              label: "すべて",
              href: href("all", actor),
              active: kind === "all",
            },
            ...(Object.keys(AUDIT_KIND_LABELS) as AuditKind[]).map((k) => ({
              label: AUDIT_KIND_LABELS[k],
              href: href(k, actor),
              active: kind === k,
            })),
          ]}
        />
        <form method="get" className="flex items-end gap-2">
          {kind !== "all" && <input type="hidden" name="kind" value={kind} />}
          <Field label="人" htmlFor="audit-actor">
            <div className="w-48">
              <Select id="audit-actor" name="actor" defaultValue={actor}>
                <option value="">全員</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.displayName}（{u.loginId}）
                  </option>
                ))}
              </Select>
            </div>
          </Field>
          <Button type="submit" variant="secondary">
            絞り込む
          </Button>
        </form>
      </div>

      {entries.length === 0 ? (
        <EmptyState icon="search_off" title="該当する記録がありません" />
      ) : (
        <TableCard>
          <Table>
            <THead>
              <Th>日時</Th>
              <Th>実行者</Th>
              <Th>操作</Th>
              <Th>内容</Th>
              <Th>IP</Th>
            </THead>
            <TBody>
              {entries.map((e) => (
                <Tr key={e.id}>
                  <Td muted nowrap>
                    {formatDateTime(e.at)}
                  </Td>
                  <Td nowrap>
                    {e.actorType === "token" ? (
                      <span className="flex items-center gap-2">
                        {e.actorName}
                        <Badge>API トークン</Badge>
                      </span>
                    ) : e.actorType === "system" ? (
                      <Badge>システム</Badge>
                    ) : (
                      e.actorName || "不明"
                    )}
                  </Td>
                  <Td nowrap>
                    <span className="flex items-center gap-2">
                      {auditLabel(e.action)}
                      <Badge
                        tone={
                          e.action === "login.failure" ||
                          e.action === "login.locked"
                            ? "warning"
                            : "neutral"
                        }
                      >
                        {AUDIT_KIND_LABELS[auditKindOf(e.action)]}
                      </Badge>
                    </span>
                  </Td>
                  <Td muted className="min-w-48 max-w-md break-words">
                    {auditDetail(e, loginIdOf)}
                  </Td>
                  <Td muted nowrap className="font-mono text-xs">
                    {e.ip}
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
