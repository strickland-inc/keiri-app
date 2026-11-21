import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { connectionRejection, verifySession, SESSION_COOKIE } from "@/lib/auth";

/** ログイン前でも読める静的なファイル（アイコン、フォント、PWA の定義）。 */
const PUBLIC_ASSET =
  /^\/(?:fonts\/|icon-|apple-touch-icon\.png$|manifest\.webmanifest$|robots\.txt$)/;

/**
 * Next.js 16 Proxy（旧 Middleware）。
 * 未ログインのアクセスは /login にリダイレクトする。
 */
export async function proxy(request: NextRequest): Promise<Response> {
  // 接続コードに問題があるときは、ログイン画面と API も含めてすべて 500 で断る。
  const rejected = connectionRejection();
  if (rejected) return rejected;

  const { pathname } = request.nextUrl;

  // /api/v1/ は API トークンで各 route が自前で認証するので、Cookie のガードは通さない。
  const isPublic =
    pathname === "/login" ||
    pathname === "/setup" ||
    pathname === "/logout" ||
    pathname.startsWith("/api/v1/") ||
    PUBLIC_ASSET.test(pathname);
  if (isPublic) return NextResponse.next();

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);

  if (session) {
    // /admin は管理者のみ。一般ユーザーはトップへ。
    if (pathname.startsWith("/admin") && session.role !== "admin") {
      const home = request.nextUrl.clone();
      home.pathname = "/";
      home.search = "";
      return NextResponse.redirect(home);
    }
    return NextResponse.next();
  }

  // 未ログイン。ログイン後に元のページへ戻せるよう next に積む。
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
