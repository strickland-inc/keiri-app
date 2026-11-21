/**
 * セッション。署名付き Cookie（HMAC-SHA256、Web Crypto なので Edge で動く）。
 * proxy.ts が import するため、Node 専用の依存を足さない。
 * 資格情報の検証は auth-server.ts にある。
 */

import {
  getConnection,
  hasConnection,
  parseConnectionCode,
} from "./gateway.ts";

export const SESSION_COOKIE = "keiri_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30日

const DEMO_SECRET = "demo-insecure-secret";
const DEMO_SESSION = { sub: "demo", role: "admin" } as const;

/**
 * 接続コードを入れずに開発用に動かしているか。
 * このときはデモデータで動き、ログインなしで管理者として扱う。本番では決してデモにしない。
 */
export function isDemoMode(): boolean {
  return process.env.NODE_ENV !== "production" && !hasConnection();
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

/** 長さが同じなら全桁を比べる（途中で止めない）。 */
function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function bytesToB64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlToBytes(s: string): Uint8Array {
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

/** セッショントークン（payload.signature）を生成する。 */
export async function createSession(
  userId: string,
  role: string = "user",
): Promise<string> {
  const payloadObj = {
    sub: userId,
    role,
    exp: Date.now() + SESSION_MAX_AGE * 1000,
  };
  const payload = bytesToB64url(
    new TextEncoder().encode(JSON.stringify(payloadObj)),
  );
  const sig = await hmac(payload, getSessionSecret());
  return `${payload}.${sig}`;
}

/** 署名と有効期限を検証し、有効なら { sub, role } を返す。 */
export async function verifySession(
  token: string | undefined,
): Promise<{ sub: string; role: string } | null> {
  if (isDemoMode()) return DEMO_SESSION;
  if (!token) return null;
  // 接続コードに問題があれば、どのセッションも無効にする（fail closed）
  if (connectionProblem()) return null;
  const secret = getSessionSecret();
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = await hmac(payload, secret);
  if (!sameText(sig, expected)) return null;
  try {
    const data = JSON.parse(new TextDecoder().decode(b64urlToBytes(payload)));
    if (typeof data.exp === "number" && data.exp < Date.now()) return null;
    if (typeof data.sub !== "string") return null;
    return {
      sub: data.sub,
      role: typeof data.role === "string" ? data.role : "user",
    };
  } catch {
    return null;
  }
}
