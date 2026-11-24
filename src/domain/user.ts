/**
 * アプリのログインユーザー。スプレッドシートでは 3 つのタブ（users、user_security、user_access）に
 * 書き手ごとに分けて持つが、ドメイン型は Repository が合成した 1 つの型にする。
 */
export type UserRole = "admin" | "user";
export type UserStatus = "active" | "disabled";

/** 画面と監査ログに出す役割の呼び名。保存する値は変えない。 */
export const ROLE_LABELS: Record<UserRole, string> = {
  admin: "管理者",
  user: "メンバー",
};

export interface User {
  id: string;
  /** 小文字にそろえて保存する。照合も小文字どうしで行う。 */
  loginId: string;
  /** 未設定なら loginId。 */
  displayName: string;
  /** user_security の値。空のときだけ users の値（既存の利用者と作成時の値）。 */
  passwordHash: string;
  role: UserRole;
  status: UserStatus;
  createdAt: string;
  /** users の行の更新日時（作成と役割の変更だけで動く）。 */
  updatedAt: string;
  passwordChangedAt: string;
  /** AES-GCM で暗号化した 2段階認証の秘密。復号は secret-box.ts。 */
  totpSecret: string;
  /** 空なら、秘密があっても有効化前（保留）。 */
  totpEnabledAt: string;
  /** 回復コードの HMAC（16 進）。 */
  recoveryCodes: string[];
  /** user_access.sessionVersion（管理者の側）。 */
  accessVersion: number;
  /** user_security.sessionVersion（本人の側）。 */
  securityVersion: number;
}

export interface NewUserInput {
  loginId: string;
  displayName: string;
  passwordHash: string;
  role: UserRole;
}

/** 画面に出してよい項目だけ。パスワードのハッシュと秘密は含まない。 */
export interface UserSummary {
  id: string;
  loginId: string;
  displayName: string;
  role: UserRole;
  status: UserStatus;
  totpEnabled: boolean;
  createdAt: string;
}

/** Cookie の sv に入れる値。`<user_access の版>.<user_security の版>`。 */
export function sessionVersionOf(
  user: Pick<User, "accessVersion" | "securityVersion">,
): string {
  return `${user.accessVersion}.${user.securityVersion}`;
}

export function normalizeLoginId(loginId: string): string {
  return loginId.trim().toLowerCase();
}

export function displayNameOf(user: Pick<User, "displayName" | "loginId">) {
  return user.displayName || user.loginId;
}
