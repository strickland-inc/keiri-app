import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth";

/** Cookie を消してログイン画面へ戻す。消されたユーザーの Cookie を片付けるのにも使う。 */
export function GET(request: Request): Response {
  const response = NextResponse.redirect(new URL("/login", request.url));
  response.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return response;
}
