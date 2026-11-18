import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { authSecretRejection, verifySession, SESSION_COOKIE } from "@/lib/auth";

/**
 * Next.js 16 Proxy（旧 Middleware）。
 * 未ログインのアクセスは /login にリダイレクトする。
 * /login と認証API・静的アセットは素通り。
 */
export async function proxy(request: NextRequest): Promise<Response> {
  // 本番で AUTH_SECRET が無い・短いときは、ログイン画面と API も含めてすべて 500 で断る。
  const rejected = authSecretRejection();
  if (rejected) return rejected;

  const { pathname } = request.nextUrl;

  // /api/agent/v1/ は Bearer トークンで各 route が自前で認証するので、Cookie のガードは通さない。
  const isPublic =
    pathname === "/login" ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/api/agent/v1/") ||
    pathname === "/robots.txt";
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
