/** 監査ログの action（英字）を、画面に出す日本語に直す対応表。 */

export type AuditKind = "auth" | "admin" | "data";

export const AUDIT_KIND_LABELS: Record<AuditKind, string> = {
  auth: "認証",
  admin: "管理",
  data: "データ",
};

const AUTH_LABELS: Record<string, string> = {
  "login.success": "ログイン",
  "login.failure": "ログイン失敗",
  "login.locked": "ログインのロック",
  logout: "ログアウト",
  "totp.enabled": "2段階認証を設定",
  "totp.disabled": "2段階認証を解除",
  "totp.reset": "2段階認証をリセット",
  "recovery.used": "回復コードでログイン",
  "recovery.regenerated": "回復コードを再発行",
  "password.changed": "パスワードを変更",
  "password.reset": "パスワードを再設定",
  "admin.recovered": "管理者を復旧",
  "sessions.revoked": "すべての端末からログアウト",
};

const ADMIN_LABELS: Record<string, string> = {
  "user.invited": "招待リンクを作成",
  "invite.revoked": "リンクを取り消し",
  "user.joined": "ユーザーが参加",
  "user.role_changed": "役割を変更",
  "user.disabled": "ユーザーを無効化",
  "user.enabled": "ユーザーを再開",
  "user.deleted": "ユーザーを削除",
  "reset.issued": "再設定リンクを作成",
  "security.require_totp_changed": "2段階認証の必須設定を変更",
  "token.created": "API トークンを発行",
  "token.revoked": "API トークンを取り消し",
};

/** データの操作は「対象.操作」の形。対象と操作の両方が分かるときだけ組み立てる。 */
const DATA_NOUNS: Record<string, string> = {
  document: "書類",
  party: "取引先",
  issuer: "会社",
  expense: "経費",
  revenue: "売上",
  bank: "銀行明細",
  setting: "設定",
  settings: "設定",
  company: "会社情報",
};

const DATA_VERBS: Record<string, string> = {
  created: "を作成",
  updated: "を更新",
  deleted: "を削除",
  voided: "を無効化",
  imported: "を取り込み",
  issued: "を発行",
  sent: "を送付済みにした",
  paid: "を入金済みにした",
  status_changed: "の状態を変更",
  classified: "の科目を変更",
  confirmed: "を確定",
};

/** 会計データを外へ持ち出した記録。 */
const EXPORT_LABELS: Record<string, string> = {
  "export.freee_csv": "freee 用 CSV を書き出し",
  "export.trial_balance_csv": "試算表 CSV を書き出し",
  "export.document_pdf": "書類の PDF をダウンロード",
};

export function auditKindOf(action: string): AuditKind {
  if (action in AUTH_LABELS) return "auth";
  if (action in ADMIN_LABELS) return "admin";
  return "data";
}

/** 知らない action は、そのまま英字で返す。 */
export function auditLabel(action: string): string {
  const known =
    AUTH_LABELS[action] ?? ADMIN_LABELS[action] ?? EXPORT_LABELS[action];
  if (known) return known;
  const [noun, verb] = action.split(".");
  if (noun && verb && DATA_NOUNS[noun] && DATA_VERBS[verb]) {
    return `${DATA_NOUNS[noun]}${DATA_VERBS[verb]}`;
  }
  return action;
}
