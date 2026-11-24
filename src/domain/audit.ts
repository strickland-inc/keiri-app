/** 監査ログの 1 行。追記だけで、書き換えない。 */
export type AuditActorType = "user" | "token" | "system";

export interface AuditEntry {
  id: string;
  /** ISO 8601 */
  at: string;
  actorType: AuditActorType;
  actorId: string;
  actorName: string;
  action: string;
  targetType: string;
  targetId: string;
  summary: string;
  ip: string;
}

export type NewAuditEntry = Omit<AuditEntry, "id" | "at">;

export interface AuditFilter {
  action?: string;
  actorId?: string;
  limit?: number;
}

/** 画面に出す最大件数。 */
export const AUDIT_LIST_MAX = 500;
