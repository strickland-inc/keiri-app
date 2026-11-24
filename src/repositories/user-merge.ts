/**
 * users、user_profiles、user_security、user_access と session_versions の行を 1 つの User に合成する純粋な処理。
 * メモリ版とスプレッドシート版で同じ意味にするため、合成と更新の計算はここに 1 つだけ置く。
 *
 * 1 つの行を書くのは 1 種類の書き手だけ（書き手が違うと、読んでから書くまでの間に、相手の変更を古い値で消してしまう）。
 *  - users: 作成と、管理者による役割の変更だけ
 *  - user_profiles: 表示名。Cookie だけで書ける
 *  - user_security: パスワードの再入力、招待・再設定のリンク、接続コードのどれかを通した操作と、管理者による 2段階認証のリセットだけ
 *  - user_access: 管理者だけ（状態）
 *  - session_versions: nextSeq だけ。必ず増えるので、古い書き込みで戻せない
 */
import type { User, UserRole, UserStatus } from "@/domain/user";

export interface UserRow {
  id: string;
  loginId: string;
  passwordHash: string;
  role: UserRole;
  createdAt: string;
  updatedAt: string;
}

export interface ProfileRow {
  id: string;
  displayName: string;
  updatedAt: string;
}

export interface SecurityRow {
  id: string;
  passwordHash: string;
  passwordChangedAt: string;
  totpSecret: string;
  totpEnabledAt: string;
  recoveryCodes: string[];
  updatedAt: string;
}

export interface AccessRow {
  id: string;
  status: UserStatus;
  updatedAt: string;
}

/** 版数の鍵。admin は管理者の操作、self は本人の操作で上がる。 */
export type VersionSide = "admin" | "self";

export function versionKey(side: VersionSide, userId: string): string {
  return `${side}:${userId}`;
}

/** 表示名の書き込み（Cookie だけで書ける）。 */
export interface ProfilePatch {
  displayName?: string;
}

/** user_security の書き込み。bumpSession は本人の側の版（self）を上げる。 */
export interface SecurityPatch {
  passwordHash?: string;
  passwordChangedAt?: string;
  totpSecret?: string;
  totpEnabledAt?: string;
  recoveryCodes?: string[];
  bumpSession?: boolean;
}

/** user_access の書き込み。bumpSession は管理者の側の版（admin）を上げる。 */
export interface AccessPatch {
  status?: UserStatus;
  bumpSession?: boolean;
}

export function emptyProfile(id: string): ProfileRow {
  return { id, displayName: "", updatedAt: "" };
}

export function emptySecurity(id: string): SecurityRow {
  return {
    id,
    passwordHash: "",
    passwordChangedAt: "",
    totpSecret: "",
    totpEnabledAt: "",
    recoveryCodes: [],
    updatedAt: "",
  };
}

export function emptyAccess(id: string): AccessRow {
  return { id, status: "active", updatedAt: "" };
}

export function mergeUser(
  user: UserRow,
  profile: ProfileRow | undefined,
  security: SecurityRow | undefined,
  access: AccessRow | undefined,
  versions: { admin: number; self: number },
): User {
  const s = security ?? emptySecurity(user.id);
  const a = access ?? emptyAccess(user.id);
  const loginId = user.loginId.trim().toLowerCase();
  return {
    id: user.id,
    loginId,
    displayName: profile?.displayName || loginId,
    passwordHash: s.passwordHash || user.passwordHash,
    role: user.role,
    status: a.status,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    passwordChangedAt: s.passwordChangedAt,
    totpSecret: s.totpSecret,
    totpEnabledAt: s.totpEnabledAt,
    recoveryCodes: s.recoveryCodes,
    accessVersion: versions.admin,
    securityVersion: versions.self,
  };
}

export function applyProfilePatch(
  row: ProfileRow,
  patch: ProfilePatch,
  now: string,
): ProfileRow {
  return {
    id: row.id,
    displayName: patch.displayName ?? row.displayName,
    updatedAt: now,
  };
}

export function applySecurityPatch(
  row: SecurityRow,
  patch: SecurityPatch,
  now: string,
): SecurityRow {
  return {
    id: row.id,
    passwordHash: patch.passwordHash ?? row.passwordHash,
    passwordChangedAt: patch.passwordChangedAt ?? row.passwordChangedAt,
    totpSecret: patch.totpSecret ?? row.totpSecret,
    totpEnabledAt: patch.totpEnabledAt ?? row.totpEnabledAt,
    recoveryCodes: patch.recoveryCodes ?? row.recoveryCodes,
    updatedAt: now,
  };
}

export function applyAccessPatch(
  row: AccessRow,
  patch: AccessPatch,
  now: string,
): AccessRow {
  return { id: row.id, status: patch.status ?? row.status, updatedAt: now };
}

/** 管理者による 2段階認証のリセット（user_security の例外の書き込み）。 */
export function clearTotp(row: SecurityRow, now: string): SecurityRow {
  return {
    ...row,
    totpSecret: "",
    totpEnabledAt: "",
    recoveryCodes: [],
    updatedAt: now,
  };
}
