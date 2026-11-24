/**
 * API トークンによる `/api/v1` の認証。
 *
 * トークンは設定画面で発行し、スプレッドシートには SHA-256 のハッシュだけを保存する。
 * トークンは十分に長い乱数なので、パスワードのような反復つきのハッシュは要らない。
 */
import type { Repositories } from "../repositories/types.ts";

const TOKEN_PREFIX = "keiri_";
const TOKEN_PATTERN = /^keiri_[A-Za-z0-9_-]{43}$/;

function toBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** 新しいトークンを作る（32 バイトの乱数）。発行した時に 1 度だけ見せる。 */
export function generateApiToken(): string {
  return TOKEN_PREFIX + toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function hashApiToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

/**
 * Authorization ヘッダーの Bearer トークンに合う、発行済みトークンの id と名前。合わなければ null。
 * 形の違うトークンは、スプレッドシートを読まずに断る。
 */
export async function authenticateApi(
  request: Request,
  repos: Pick<Repositories, "apiTokens">,
): Promise<{ id: string; name: string } | null> {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  const token = authorization.slice("Bearer ".length);
  if (!TOKEN_PATTERN.test(token)) return null;
  const hash = await hashApiToken(token);
  const tokens = await repos.apiTokens.list();
  const found = tokens.find((stored) => stored.tokenHash === hash);
  return found ? { id: found.id, name: found.name } : null;
}

/** トークンが、発行済みのトークンと一致するか。 */
export async function authorizeApi(
  request: Request,
  repos: Pick<Repositories, "apiTokens">,
): Promise<boolean> {
  return (await authenticateApi(request, repos)) !== null;
}

export function unauthorized(): Response {
  return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
}
