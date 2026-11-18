"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { getRepositories } from "@/repositories";
import {
  ACTIVE_COMPANY_COOKIE,
  ACTIVE_COMPANY_MAX_AGE,
} from "@/lib/active-company";

/**
 * 見ている会社を切り替える。
 * 実在する会社の id のときだけ Cookie を書く（不正な値で全画面が空になるのを防ぐ）。
 */
export async function switchCompany(formData: FormData): Promise<void> {
  const companyId = String(formData.get("companyId") ?? "").trim();
  if (!companyId) return;

  const repos = await getRepositories();
  const company = await repos.issuers.get(companyId);
  if (!company) return;

  const store = await cookies();
  store.set(ACTIVE_COMPANY_COOKIE, companyId, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: ACTIVE_COMPANY_MAX_AGE,
  });

  // 会社を跨いで表示が残らないよう、レイアウトごと作り直す。
  revalidatePath("/", "layout");
}
