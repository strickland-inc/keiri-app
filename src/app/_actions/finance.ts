"use server";

import { assertSession } from "@/lib/session";
import { isYen } from "@/domain/limits";

import { revalidatePath } from "next/cache";
import { getRepositories } from "@/repositories";
import { companySettingKey, loadCompanyContext } from "@/lib/active-company";

export async function updateCashBalance(value: number): Promise<void> {
  await assertSession();
  const amount = Math.round(Number(value));
  if (!isYen(amount)) throw new Error("金額が不正です");
  const repos = await getRepositories();
  const company = await loadCompanyContext(repos);
  await repos.settings.set(
    companySettingKey(company, "cash_balance"),
    String(amount),
  );
  revalidatePath("/");
}
