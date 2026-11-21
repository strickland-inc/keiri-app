"use server";

import { assertSession } from "@/lib/session";
import { isIsoDate, isYen } from "@/domain/limits";

import { getRepositories } from "@/repositories";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { NewRevenueInput } from "@/domain/revenue";
import { loadCompanyContext } from "@/lib/active-company";
import type { Repositories } from "@/repositories/types";

/**
 * 売上の所属会社は、フォームの値ではなく「今見ている会社」で決める。
 * documents/actions.ts の resolveIssuerId と同じ理由。
 */
async function resolveIssuerId(repos: Repositories): Promise<string> {
  const company = await loadCompanyContext(repos);
  if (!company.active) throw new Error("会社が登録されていません");
  return company.active.id;
}

function parseRevenueFromFormData(
  formData: FormData,
  issuerId: string,
): NewRevenueInput {
  const optStr = (key: string): string | undefined => {
    const v = formData.get(key);
    if (typeof v !== "string" || !v.trim()) return undefined;
    return v.trim();
  };

  const date = String(formData.get("date") ?? "").trim();
  if (!isIsoDate(date)) throw new Error("日付は YYYY-MM-DD で入れてください");

  const amountRaw = String(formData.get("amount") ?? "").trim();
  const amount = Math.trunc(Number(amountRaw));
  if (!amountRaw || !isYen(amount) || amount === 0) {
    throw new Error("金額は必須です");
  }

  return {
    issuerId,
    date,
    partyId: optStr("partyId"),
    partyName: String(formData.get("partyName") ?? "").trim(),
    amount,
    description: String(formData.get("description") ?? "").trim(),
    source: optStr("source") ?? "通帳",
    documentId: optStr("documentId"),
  };
}

export async function createRevenue(formData: FormData): Promise<void> {
  await assertSession();
  const repos = await getRepositories();
  const issuerId = await resolveIssuerId(repos);
  const input = parseRevenueFromFormData(formData, issuerId);
  await repos.revenues.create(input);
  revalidatePath("/revenues");
  redirect("/revenues");
}

export async function removeRevenue(id: string): Promise<void> {
  await assertSession();
  const repos = await getRepositories();
  await repos.revenues.remove(id);
  revalidatePath("/revenues");
}
