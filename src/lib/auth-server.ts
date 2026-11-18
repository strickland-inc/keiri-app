/**
 * 認証のサーバー専用部分。パスワードのハッシュ（PBKDF2）と Repository に依存するため、
 * Edge で動く lib/auth.ts とは分離する（proxy が重い依存を巻き込まないように）。
 */
import { getRepositories } from "@/repositories";
import type { UserRole } from "@/domain/user";

export interface AuthResult {
  userId: string;
  role: UserRole;
}

/**
 * ログイン資格情報を検証する。
 * 1) 環境変数の管理者（ブートストラップ。ユーザーが1人もいなくても管理者ログインできる）
 * 2) 保存済みユーザー（loginId + bcrypt 照合）
 */
export async function verifyCredentials(
  loginId: string,
  password: string,
): Promise<AuthResult | null> {
  const adminId = process.env.APP_LOGIN_ID;
  const adminPw = process.env.APP_LOGIN_PASSWORD;
  if (
    adminId &&
    adminPw &&
    constantTimeEqual(loginId, adminId) &&
    constantTimeEqual(password, adminPw)
  ) {
    return { userId: adminId, role: "admin" };
  }

  const repos = await getRepositories();
  const user = await repos.users.findByLoginId(loginId);
  if (user && (await verifyPassword(password, user.passwordHash))) {
    return { userId: user.id, role: user.role };
  }
  return null;
}

// ── パスワードのハッシュ ───────────────────────────────────────────────────────
// PBKDF2-SHA256（Web Crypto）。bcrypt は純 JS で CPU を使い、Cloudflare Workers の無料枠
// （CPU 10ms/リクエスト）に収まらないため。パスワードは generatePassword が作る
// ランダム 12 文字（約 70 ビット）なので、反復回数を抑えても総当たりには耐える。
const PBKDF2_PREFIX = "pbkdf2-sha256";
const PBKDF2_ITERATIONS = 20_000;

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex: string): Uint8Array {
  return Uint8Array.from(hex.match(/.{2}/g) ?? [], (h) => parseInt(h, 16));
}

/** 長さが同じなら全桁を比べる（途中で止めない）。 */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function derive(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations },
    key,
    256,
  );
  return toHex(new Uint8Array(bits));
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt, PBKDF2_ITERATIONS);
  return `${PBKDF2_PREFIX}$${PBKDF2_ITERATIONS}$${toHex(salt)}$${hash}`;
}

/** 新形式（PBKDF2）と、以前に発行した bcrypt 形式の両方を照合する。 */
export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  if (stored.startsWith(`${PBKDF2_PREFIX}$`)) {
    const [, iterations, salt, hash] = stored.split("$");
    const n = Number(iterations);
    if (!Number.isInteger(n) || n < 1 || !salt || !hash) return false;
    return constantTimeEqual(await derive(password, fromHex(salt), n), hash);
  }
  // 旧形式（bcrypt）。使うときだけ読み込む（CPU を使うため、Workers 無料枠では失敗しうる）
  if (stored.startsWith("$2")) {
    const bcrypt = (await import("bcryptjs")).default;
    return bcrypt.compare(password, stored);
  }
  return false;
}

/** 紛らわしい文字を除いたランダムパスワードを生成する。 */
export function generatePassword(length = 12): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let out = "";
  for (let i = 0; i < length; i++) out += chars[bytes[i] % chars.length];
  return out;
}
