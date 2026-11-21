/**
 * 認証のうち、パスワードのハッシュ（PBKDF2）と Repository に依存する部分。
 * proxy が読み込む lib/auth.ts とは分ける（proxy が Repository を巻き込まないように）。
 */
import { getRepositories } from "@/repositories";
import type { UserRole } from "@/domain/user";

export interface AuthResult {
  userId: string;
  role: UserRole;
}

/** ログイン ID とパスワードを、保存済みのユーザーと照合する。 */
export async function verifyCredentials(
  loginId: string,
  password: string,
): Promise<AuthResult | null> {
  const repos = await getRepositories();
  const user = await repos.users.findByLoginId(loginId);
  // ユーザーが無いときも同じ計算をして、応答の速さから ID の有無が分からないようにする。
  const ok = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
  return user && ok ? { userId: user.id, role: user.role } : null;
}

// ── パスワードのハッシュ ───────────────────────────────────────────────────────
// PBKDF2-SHA256（Web Crypto）。Cloudflare Workers の無料枠（CPU 10ms/リクエスト）に収めるため、
// 反復回数を抑えている。その分、パスワードは 12 文字以上にして、総当たりに耐えるようにする。
const PBKDF2_PREFIX = "pbkdf2-sha256";
const PBKDF2_ITERATIONS = 20_000;
const DUMMY_HASH = `${PBKDF2_PREFIX}$${PBKDF2_ITERATIONS}$${"0".repeat(32)}$${"0".repeat(64)}`;

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex: string): Uint8Array {
  return Uint8Array.from(hex.match(/.{2}/g) ?? [], (h) => parseInt(h, 16));
}

/** 長さが同じなら全桁を比べる（途中で止めない）。 */
export function constantTimeEqual(a: string, b: string): boolean {
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

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  if (!stored.startsWith(`${PBKDF2_PREFIX}$`)) return false;
  const [, iterations, salt, hash] = stored.split("$");
  const n = Number(iterations);
  if (!Number.isInteger(n) || n < 1 || !salt || !hash) return false;
  return constantTimeEqual(await derive(password, fromHex(salt), n), hash);
}

/** 紛らわしい文字を除いたランダムパスワードを生成する。 */
export function generatePassword(length = 12): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let out = "";
  for (let i = 0; i < length; i++) out += chars[bytes[i] % chars.length];
  return out;
}
