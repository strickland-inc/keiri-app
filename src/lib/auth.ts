/**
 * セッション。署名付き Cookie（HMAC-SHA256、Web Crypto なので Edge で動く）。
 * proxy.ts が import するため、Node 専用の依存を足さない。
 * 資格情報の検証は Node 専用の auth-server.ts にある。
 */

export const SESSION_COOKIE = "keiri_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30日

const DEV_SECRET = "dev-insecure-secret-change-me";
const MIN_SECRET_LENGTH = 16;

/**
 * AUTH_SECRET に問題があれば、その理由を返す。問題がなければ null。
 * 本番（NODE_ENV=production）では 16 文字以上の AUTH_SECRET が必須。開発中は未設定でもよい。
 * 本番で未設定のまま動くと、誰でも Cookie を偽造してログインできてしまう。
 */
export function authSecretProblem(): string | null {
  if (process.env.NODE_ENV !== "production") return null;
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    return "AUTH_SECRET が未設定です。本番では 16 文字以上のランダムな値を設定してください（.env.example を参照）";
  }
  if (secret.length < MIN_SECRET_LENGTH) {
    return `AUTH_SECRET が短すぎます（${secret.length} 文字）。16 文字以上のランダムな値を設定してください`;
  }
  return null;
}

/**
 * 本番で AUTH_SECRET に問題があるときに返す 500 の応答。問題がなければ null。
 * proxy.ts が全リクエストの最初に呼ぶ。Cloudflare Workers ではプロセスを止められないため、
 * ログイン画面と API も含めて、ここで断る（Node の next start は instrumentation でも止める）。
 */
export function authSecretRejection(): Response | null {
  const problem = authSecretProblem();
  if (!problem) return null;
  console.error(problem);
  return new Response(
    "サーバーの設定が足りないため、利用できません。管理者は AUTH_SECRET を設定してください。",
    { status: 500, headers: { "content-type": "text/plain; charset=utf-8" } },
  );
}

/**
 * Cookie の署名に使う秘密の値。開発中だけ、未設定でも固定値で動かす。
 * 本番で AUTH_SECRET に問題があれば例外を投げる（署名も検証もしない）。
 */
export function getSessionSecret(): string {
  const problem = authSecretProblem();
  if (problem) throw new Error(problem);
  return process.env.AUTH_SECRET || DEV_SECRET;
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
  if (!token) return null;
  // 鍵が無い本番では、どのセッションも無効にする（fail closed）
  if (authSecretProblem()) return null;
  const secret = getSessionSecret();
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = await hmac(payload, secret);
  if (sig !== expected) return null;
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
