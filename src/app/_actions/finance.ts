"use server";

import { revalidatePath } from "next/cache";
import { getRepositories } from "@/repositories";
import { companySettingKey, loadCompanyContext } from "@/lib/active-company";

export async function updateCashBalance(value: number): Promise<void> {
  const repos = await getRepositories();
  const company = await loadCompanyContext(repos);
  await repos.settings.set(
    companySettingKey(company, "cash_balance"),
    String(Math.round(value)),
  );
  revalidatePath("/");
}
