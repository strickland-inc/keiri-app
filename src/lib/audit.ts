/**
 * 監査ログ。誰が・いつ・何をしたかを audit_log に追記する。書き込みに失敗しても投げない。
 * summary に、パスワード・トークン・接続コード・回復コード・2段階認証の秘密を入れない。
 */
import type { AuditEntry, AuditFilter } from "@/domain/audit";
import { AUDIT_LIST_MAX } from "@/domain/audit";
import { getRepositories } from "@/repositories";
import type { Session } from "./session.ts";

/** 監査ログに残す、操作した人。 */
export type AuditActor =
  | Session
  /** `/api/v1` のトークン。 */
  | { tokenName: string }
  /** まだログインしていない人（ログインの失敗など）。 */
  | { userId: string; name: string }
  | "system";

const SUMMARY_MAX = 500;

/** cf-connecting-ip → x-forwarded-for の先頭 → ""。要求の外（テストなど）では ""。 */
export async function clientIp(): Promise<string> {
  try {
    const { headers } = await import("next/headers");
    const h = await headers();
    const ip =
      h.get("cf-connecting-ip") ??
      h.get("x-forwarded-for")?.split(",")[0] ??
      "";
    return ip.trim().slice(0, 64);
  } catch {
    return "";
  }
}

function describeActor(
  actor: AuditActor,
): Pick<AuditEntry, "actorType" | "actorId" | "actorName"> {
  if (actor === "system") {
    return { actorType: "system", actorId: "", actorName: "system" };
  }
  if ("tokenName" in actor) {
    return { actorType: "token", actorId: "", actorName: actor.tokenName };
  }
  if ("userId" in actor) {
    return { actorType: "user", actorId: actor.userId, actorName: actor.name };
  }
  return {
    actorType: "user",
    actorId: actor.sub,
    actorName: actor.displayName || actor.loginId,
  };
}

/**
 * 1 行追記する。失敗しても本体の操作は失敗させず、console.error に残す。
 * ip を渡さないときは、今の要求のヘッダーから読む。
 */
export async function recordAudit(
  actor: AuditActor,
  action: string,
  target?: { type: string; id?: string },
  summary?: string,
  ip?: string,
): Promise<void> {
  try {
    const repos = await getRepositories();
    await repos.audit.append({
      ...describeActor(actor),
      action,
      targetType: target?.type ?? "",
      targetId: target?.id ?? "",
      summary: (summary ?? "").slice(0, SUMMARY_MAX),
      ip: ip ?? (await clientIp()),
    });
  } catch (error) {
    console.error("監査ログを書けませんでした", action, error);
  }
}

/** 新しい順に最大 500 件。 */
export async function listAudit(filter?: AuditFilter): Promise<AuditEntry[]> {
  const repos = await getRepositories();
  return repos.audit.list({
    ...filter,
    limit: Math.min(filter?.limit ?? AUDIT_LIST_MAX, AUDIT_LIST_MAX),
  });
}
