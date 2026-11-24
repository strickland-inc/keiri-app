/**
 * セッション。署名付き Cookie（HMAC-SHA256、Web Crypto なので Edge で動く）。
 * proxy.ts が import するため、Node 専用の依存や Repository を足さない。
 * 資格情報の検証は auth-server.ts にある。
 */

import {
  getConnection,
  hasConnection,
  parseConnectionCode,
} from "./gateway.ts";

export const SESSION_COOKIE = "keiri_session";
/** 2段階認証・設定の途中の印。セッションとは別の Cookie、別の署名の鍵。 */
export const PENDING_COOKIE = "keiri_pending";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30日
export const PENDING_MAX_AGE = 5 * 60; // 5分

const DEMO_SECRET = "demo-insecure-secret";
const DEMO_PENDING_SECRET = "demo-insecure-pending";
/** 試用モードのログインの流れで、接続コードの代わりに受け付ける固定の文字列。 */
export const DEMO_CONNECTION_CODE = "demo";
const DEMO_SESSION = { sub: "demo", role: "admin", sv: "0.0" } as const;

export type PendingPurpose = "totp" | "enroll";

export interface VerifiedSession {
  sub: string;
  role: string;
  /** `<user_access の版>.<user_security の版>`。古い Cookie は "0.0"。 */
  sv: string;
}

/**
 * 本物のログインの流れを、デモのデータ（メモリ）のまま通す試用モードか。
 * 本番以外で、かつ接続コードが未設定のときだけ、KEIRI_DEMO_AUTH=1 で有効になる。本番では決して有効にならない。
 */
export function isDemoAuth(): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    !hasConnection() &&
    process.env.KEIRI_DEMO_AUTH === "1"
  );
}

/**
 * 接続コードを入れずに開発用に動かしているか。
 * このときはデモデータで動き、ログインなしで管理者として扱う。本番では決してデモにしない。
 * KEIRI_DEMO_AUTH=1 のときは本物のログインの流れを通すので、ここは false。
 */
export function isDemoMode(): boolean {
  return (
    process.env.NODE_ENV !== "production" && !hasConnection() && !isDemoAuth()
  );
}

/**
 * 接続コード（KEIRI_CONNECTION）に問題があれば、その理由を返す。問題がなければ null。
 * 本番で未設定のまま動くと、保存先が無いうえに、Cookie の署名に使う鍵も無い。
 */
export function connectionProblem(): string | null {
  const code = process.env.KEIRI_CONNECTION;
  if (!code) {
    return process.env.NODE_ENV === "production"
      ? "KEIRI_CONNECTION が未設定です。スプレッドシートのメニュー「keiri-app」で接続コードを発行して設定してください"
      : null;
  }
  return parseConnectionCode(code)
    ? null
    : "KEIRI_CONNECTION の形が違います。スプレッドシートのメニュー「keiri-app」で接続コードを発行し直してください";
}

/**
 * 接続コードに問題があるときに返す 500 の応答。問題がなければ null。
 * proxy.ts が全リクエストの最初に呼ぶ。Cloudflare Workers ではプロセスを止められないため、
 * ログイン画面と API も含めて、ここで断る。
 */
export function connectionRejection(): Response | null {
  const problem = connectionProblem();
  if (!problem) return null;
  console.error(problem);
  return new Response(
    "サーバーの設定が足りないため、利用できません。管理者は KEIRI_CONNECTION を設定してください。",
    { status: 500, headers: { "content-type": "text/plain; charset=utf-8" } },
  );
}

/**
 * Cookie の署名に使う秘密の値。接続コードの鍵から決めるので、別の秘密を設定しなくてよい。
 * 接続コードを作り直すと、全員がログアウトになる。
 */
export function getSessionSecret(): string {
  const problem = connectionProblem();
  if (problem) throw new Error(problem);
  const connection = getConnection();
  return connection ? `keiri-session:${connection.key}` : DEMO_SECRET;
}

/** 保留 Cookie の署名の鍵。セッションの鍵とは別なので、保留 Cookie をセッションに入れ替えても通らない。 */
export function getPendingSecret(): string {
  const problem = connectionProblem();
  if (problem) throw new Error(problem);
  const connection = getConnection();
  return connection ? `keiri-pending:${connection.key}` : DEMO_PENDING_SECRET;
}

/**
 * 暗号と HMAC の鍵を作る元の値（接続コードの鍵）。HKDF の入力にするだけで、そのまま鍵にしない。
 * 接続コードを作り直すと変わるので、暗号化した 2段階認証の秘密は読めなくなる（未設定として扱う）。
 */
export function getKeyMaterial(): string {
  const problem = connectionProblem();
  if (problem) throw new Error(problem);
  const connection = getConnection();
  return connection ? connection.key : DEMO_SECRET;
}

/** 長さが同じなら全桁を比べる（途中で止めない）。 */
export function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * /setup と /recover で入力された接続コードが、持ち主のものか。定数時間で比べる。
 * 試用モード（isDemoAuth）のときだけ、固定の文字列 "demo" も受け付ける。
 */
export function connectionCodeMatches(input: string): boolean {
  const entered = input.trim();
  if (isDemoAuth()) return sameText(entered, DEMO_CONNECTION_CODE);
  const code = process.env.KEIRI_CONNECTION?.trim();
  if (!code || connectionProblem()) return false;
  return sameText(entered, code);
}

export function bytesToB64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function hmac(data: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(data),
  );
  return bytesToB64url(new Uint8Array(sig));
}

async function sign(
  payloadObj: Record<string, unknown>,
  secret: string,
): Promise<string> {
  const payload = bytesToB64url(
    new TextEncoder().encode(JSON.stringify(payloadObj)),
  );
  return `${payload}.${await hmac(payload, secret)}`;
}

/** 署名と有効期限を確かめ、payload を返す。 */
async function openToken(
  token: string | undefined,
  secret: string,
): Promise<Record<string, unknown> | null> {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = await hmac(payload, secret);
  if (!sameText(sig, expected)) return null;
  try {
    const data: unknown = JSON.parse(
      new TextDecoder().decode(b64urlToBytes(payload)),
    );
    if (typeof data !== "object" || data === null) return null;
    const record = data as Record<string, unknown>;
    if (typeof record.exp === "number" && record.exp < Date.now()) return null;
    return record;
  } catch {
    return null;
  }
}

/** セッショントークン（payload.signature）を生成する。sv は、そのときのセッションの版。 */
export async function createSession(
  userId: string,
  role: string = "user",
  sv: string = "0.0",
): Promise<string> {
  return sign(
    { sub: userId, role, sv, exp: Date.now() + SESSION_MAX_AGE * 1000 },
    getSessionSecret(),
  );
}

/** 署名と有効期限を検証し、有効なら { sub, role, sv } を返す。保留 Cookie（purpose 入り）は通さない。 */
export async function verifySession(
  token: string | undefined,
): Promise<VerifiedSession | null> {
  if (isDemoMode()) return DEMO_SESSION;
  if (!token) return null;
  // 接続コードに問題があれば、どのセッションも無効にする（fail closed）
  if (connectionProblem()) return null;
  const data = await openToken(token, getSessionSecret());
  if (!data || typeof data.sub !== "string") return null;
  if ("purpose" in data) return null;
  return {
    sub: data.sub,
    role: typeof data.role === "string" ? data.role : "user",
    // sv の無い古い Cookie は "0.0" として扱い、更新した直後に全員がログアウトになるのを避ける
    sv: typeof data.sv === "string" ? data.sv : "0.0",
  };
}

/** 保留 Cookie（5 分）を生成する。セッションとは別の鍵で署名する。 */
export async function createPending(
  userId: string,
  purpose: PendingPurpose,
  sv: string,
): Promise<string> {
  return sign(
    { sub: userId, purpose, sv, exp: Date.now() + PENDING_MAX_AGE * 1000 },
    getPendingSecret(),
  );
}

/** 保留 Cookie を検証する。purpose が違うものと、セッションの Cookie は通さない。 */
export async function verifyPending(
  token: string | undefined,
  purpose: PendingPurpose,
): Promise<{ sub: string; sv: string } | null> {
  if (connectionProblem()) return null;
  const data = await openToken(token, getPendingSecret());
  if (!data || typeof data.sub !== "string") return null;
  if (data.purpose !== purpose) return null;
  return { sub: data.sub, sv: typeof data.sv === "string" ? data.sv : "0.0" };
}
