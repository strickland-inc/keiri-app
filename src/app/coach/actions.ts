"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { SESSION_COOKIE, verifySession } from "@/lib/auth";
import {
  parsePlannedCommitmentsText,
  type MoneyPlan,
} from "@/domain/money-coach";
import { getRepositories } from "@/repositories";

function amount(formData: FormData, name: string, required = false): number {
  const raw = String(formData.get(name) ?? "")
    .replaceAll(",", "")
    .trim();
  if (!raw && !required) return 0;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0)
    throw new Error(`${name}は0以上の金額で入力してください`);
  return Math.trunc(value);
}

export async function saveMoneyPlan(formData: FormData): Promise<void> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!(await verifySession(token))) throw new Error("認証が必要です");

  const month = String(formData.get("month") ?? "");
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
    throw new Error("対象月が不正です");

  const plan: MoneyPlan = {
    month,
    targetAmount: amount(formData, "targetAmount", true),
    bufferAmount: amount(formData, "bufferAmount"),
    variableForecastAmount: amount(formData, "variableForecastAmount"),
    plannedCommitments: parsePlannedCommitmentsText(
      String(formData.get("plannedCommitments") ?? ""),
    ),
  };

  const repos = await getRepositories();
  await repos.settings.set(`money_plan:${month}`, JSON.stringify(plan));
  revalidatePath("/coach");
  redirect(`/coach?month=${month}`);
}
