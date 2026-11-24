/** 招待と再設定のリンク。保存するのはトークンの SHA-256 だけ。 */
export type InviteKind = "invite" | "reset";

export interface Invite {
  id: string;
  kind: InviteKind;
  tokenHash: string;
  /** reset のときだけ。 */
  userId: string;
  /** invite のときの役割。 */
  role: "admin" | "user";
  note: string;
  createdBy: string;
  createdAt: string;
  expiresAt: string;
  usedAt: string;
}

export type NewInviteInput = Omit<Invite, "id" | "createdAt" | "usedAt">;

export type InviteStatus = "pending" | "used" | "expired";

export interface InviteSummary extends Omit<Invite, "tokenHash"> {
  status: InviteStatus;
}

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const RESET_TTL_MS = 24 * 60 * 60 * 1000;

export function inviteStatus(invite: Invite, nowMs: number): InviteStatus {
  if (invite.usedAt) return "used";
  return Date.parse(invite.expiresAt) <= nowMs ? "expired" : "pending";
}
