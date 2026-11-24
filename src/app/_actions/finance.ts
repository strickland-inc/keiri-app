"use server";

import { assertSession } from "@/lib/session";
import { recordAudit } from "@/lib/audit";
import { isYen } from "@/domain/limits";

import { revalidatePath } from "next/cache";
import { getRepositories } from "@/repositories";
import { companySettingKey, loadCompanyContext } from "@/lib/active-company";

export async function updateCashBalance(value: number): Promise<void> {
  const session = await assertSession();
  const amount = Math.round(Number(value));
  if (!isYen(amount)) throw new Error("金額が不正です");
  const repos = await getRepositories();
  const company = await loadCompanyContext(repos);
  await repos.settings.set(
    companySettingKey(company, "cash_balance"),
    String(amount),
  );
  await recordAudit(
    session,
    "settings.updated",
    { type: "setting", id: "cash_balance" },
    `手元の現金残高を ${amount.toLocaleString("ja-JP")} 円に更新`,
  );
  revalidatePath("/");
}
