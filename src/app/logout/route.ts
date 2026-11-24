import { NextResponse } from "next/server";
import { PENDING_COOKIE, SESSION_COOKIE } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { loadSession } from "@/lib/session";

/**
 * Cookie を消してログイン画面へ戻す。消されたユーザーの Cookie を片付けるのにも使う。
 * 誰がログアウトしたか分かるとき（有効なセッションがあるとき）だけ、監査ログに残す。
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const { session } = await loadSession();
    if (session) {
      await recordAudit(session, "logout", { type: "user", id: session.sub });
    }
  } catch {
    // スプレッドシートに届かなくても、Cookie は消す
  }
  const response = NextResponse.redirect(new URL("/login", request.url));
  response.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  // 保留 Cookie は /login 以下にだけ付いている
  response.cookies.set(PENDING_COOKIE, "", { path: "/login", maxAge: 0 });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
