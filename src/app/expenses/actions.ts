"use server";

import { getRepositories } from "@/repositories";
import { isExpenseCategory } from "@/domain/expense";
import { normalizeMerchant } from "@/domain/reports";
import type { Repositories } from "@/repositories/types";
import { loadCompanyContext } from "@/lib/active-company";
import { revalidatePath } from "next/cache";

/**
 * 確定した経費の利用先を自己学習辞書に記憶する。
 * 次回から同じ利用先（正規化キー一致）は AI を介さず即確定できる。
 * category が「要確認」の間は確定とみなさず学習しない。
 */
async function learnFromExpense(
  repos: Repositories,
  id: string,
): Promise<void> {
  const exp = await repos.expenses.get(id);
  if (!exp || exp.category === "要確認") return;
  const key = normalizeMerchant(exp.merchant);
  if (!key) return;
  await repos.merchantRules.upsert({
    key,
    sampleMerchant: exp.merchant,
    category: exp.category,
  });
}

export async function createExpense(input: {
  date: string;
  merchant: string;
  amount: number;
  category: string;
  note?: string;
}): Promise<void> {
  const category = isExpenseCategory(input.category)
    ? input.category
    : "要確認";
  const repos = await getRepositories();
  const company = await loadCompanyContext(repos);
  await repos.expenses.create({
    issuerId: company.active?.id,
    date: input.date,
    merchant: input.merchant,
    amount: Math.round(input.amount),
    category,
    source: "領収書スキャン",
    note: input.note ?? "",
  });
  revalidatePath("/expenses");
}

export async function updateExpenseCategory(
  id: string,
  category: string,
): Promise<void> {
  if (!isExpenseCategory(category)) return;
  const repos = await getRepositories();
  await repos.expenses.update(id, { category });
  await learnFromExpense(repos, id);
  revalidatePath("/expenses");
}
