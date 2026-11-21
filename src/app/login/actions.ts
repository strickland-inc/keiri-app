"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/lib/auth";
import { verifyCredentials } from "@/lib/auth-server";
import { sitePath } from "@/lib/site-path";
import { startSession } from "@/lib/session";

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

  await startSession(result.userId, result.role);

  redirect(sitePath(next));
}

export async function logout(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  redirect("/login");
}
