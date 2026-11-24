import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { connectionRejection, verifySession, SESSION_COOKIE } from "@/lib/auth";
import { securityHeaders } from "@/lib/security-headers";

/** ログイン前でも読める静的なファイル（アイコン、フォント、PWA の定義）。 */
const PUBLIC_ASSET =
  /^\/(?:fonts\/|icon-|apple-touch-icon\.png$|manifest\.webmanifest$|robots\.txt$)/;

/** ログイン前でも開ける画面（ちょうどこのパス）。 */
const PUBLIC_PATHS = new Set([
  "/login",
  "/login/verify",
  "/login/enroll",
  "/setup",
  "/logout",
  "/recover",
]);

/** ログイン前でも開ける画面（この下すべて）。招待と再設定は、リンクのトークンが鍵になる。 */
const PUBLIC_PREFIXES = ["/invite/", "/reset/", "/api/v1/"];

function isPublic(pathname: string): boolean {
  return (
    PUBLIC_PATHS.has(pathname) ||
    PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix)) ||
    PUBLIC_ASSET.test(pathname)
  );
}

/** 全応答に応答ヘッダーを付ける。 */
function withHeaders(response: Response, pathname: string): Response {
  const headers = securityHeaders({
    pathname,
    production: process.env.NODE_ENV === "production",
  });
  for (const [name, value] of Object.entries(headers)) {
    response.headers.set(name, value);
  }
  return response;
}

/**
 * Next.js 16 Proxy（旧 Middleware）。
 * 未ログインのアクセスは /login にリダイレクトする。ここでは Cookie の署名だけを見る。
 * ユーザーが今も使えるか、管理者か、の最終的な確認は layout と各 Server Action（assertSession / assertAdmin）が行う。
 */
export async function proxy(request: NextRequest): Promise<Response> {
  const { pathname } = request.nextUrl;

  // 接続コードに問題があるときは、ログイン画面と API も含めてすべて 500 で断る。
  const rejected = connectionRejection();
  if (rejected) return withHeaders(rejected, pathname);

  // /api/v1/ は API トークンで各 route が自前で認証するので、Cookie のガードは通さない。
  if (isPublic(pathname)) return withHeaders(NextResponse.next(), pathname);

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);

  if (session) {
    // /admin は管理者のみ。メンバーはトップへ。
    if (
      (pathname === "/admin" || pathname.startsWith("/admin/")) &&
      session.role !== "admin"
    ) {
      const home = request.nextUrl.clone();
      home.pathname = "/";
      home.search = "";
      return withHeaders(NextResponse.redirect(home), pathname);
    }
    return withHeaders(NextResponse.next(), pathname);
  }

  // 未ログイン。ログイン後に元のページへ戻せるよう next に積む。
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search =
    pathname === "/"
      ? ""
      : `?next=${encodeURIComponent(pathname + request.nextUrl.search)}`;
  return withHeaders(NextResponse.redirect(url), pathname);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
