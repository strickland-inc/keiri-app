"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createSession, SESSION_COOKIE, SESSION_MAX_AGE } from "@/lib/auth";
import { verifyCredentials } from "@/lib/auth-server";

export async function login(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "/");

  const result = await verifyCredentials(id, password);
  if (!result) {
    redirect(
      `/login?error=1${next && next !== "/" ? `&next=${encodeURIComponent(next)}` : ""}`,
    );
  }

  const token = await createSession(result.userId, result.role);
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });

  // ログイン後の遷移先はサイト内のパスだけに限る。
  // "//example.com" や "/\\example.com" はブラウザが別のサイトの URL として読むので通さない。
  const isSitePath = /^\/(?![/\\])/.test(next);
  redirect(isSitePath ? next : "/");
}

export async function logout(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  redirect("/login");
}
