"use server";

import { assertSession } from "@/lib/session";
import { isIsoDate, isYen, LIMITS } from "@/domain/limits";

import { getRepositories } from "@/repositories";
import { isExpenseCategory, type ExpenseCategory } from "@/domain/expense";
import { normalizeMerchant } from "@/domain/reports";
import type { Repositories } from "@/repositories/types";
import { loadCompanyContext } from "@/lib/active-company";
import { revalidatePath } from "next/cache";
import { z } from "zod";

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
  await assertSession();
  const amount = Math.round(Number(input.amount));
  if (!isIsoDate(input.date)) throw new Error("日付が不正です");
  if (!isYen(amount)) throw new Error("金額が不正です");
  const category = isExpenseCategory(input.category)
    ? input.category
    : "要確認";
  const repos = await getRepositories();
  const company = await loadCompanyContext(repos);
  await repos.expenses.create({
    issuerId: company.active?.id,
    date: input.date,
    merchant: String(input.merchant).slice(0, LIMITS.line),
    amount,
    category,
    source: "領収書スキャン",
    note: String(input.note ?? "").slice(0, LIMITS.text),
  });
  revalidatePath("/expenses");
}

export async function updateExpenseCategory(
  id: string,
  category: string,
): Promise<void> {
  await assertSession();
  if (!isExpenseCategory(category)) return;
  const repos = await getRepositories();
  await repos.expenses.update(id, { category });
  await learnFromExpense(repos, id);
  revalidatePath("/expenses");
}

export interface ManualExpenseValues {
  date: string;
  merchant: string;
  amount: string;
  category: string;
  note: string;
}

export interface ManualExpenseState {
  ok: boolean;
  /** 検証で落ちたとき、入力を消さずに戻すための値。 */
  values?: ManualExpenseValues;
  errors?: Partial<Record<keyof ManualExpenseValues, string>>;
}

const manualExpenseSchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "日付を入力してください")
    // 2月30日のような存在しない日付を、正規表現だけでは弾けない
    .refine((v) => {
      const d = new Date(`${v}T00:00:00Z`);
      // 13月のような値は Invalid Date になり、toISOString が例外を投げる
      return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(v);
    }, "存在しない日付です"),
  merchant: z
    .string()
    .min(1, "利用先を入力してください")
    .max(100, "利用先は100文字以内で入力してください"),
  amount: z
    .string()
    .regex(/^\d+$/, "金額は1以上の整数で入力してください")
    .transform(Number)
    .refine(
      (v) => Number.isSafeInteger(v) && v >= 1,
      "金額は1以上の整数で入力してください",
    ),
  category: z
    .string()
    .refine(
      (v) => v === "" || isExpenseCategory(v),
      "費目を選び直してください",
    ),
  note: z.string().max(500, "メモは500文字以内で入力してください"),
});

function readText(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}

export async function createManualExpense(
  _prev: ManualExpenseState,
  formData: FormData,
): Promise<ManualExpenseState> {
  await assertSession();
  const values: ManualExpenseValues = {
    date: readText(formData, "date"),
    merchant: readText(formData, "merchant"),
    amount: readText(formData, "amount"),
    category: readText(formData, "category"),
    note: readText(formData, "note"),
  };

  const parsed = manualExpenseSchema.safeParse(values);
  if (!parsed.success) {
    const errors: ManualExpenseState["errors"] = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (typeof key === "string" && key in values && !(key in errors)) {
        errors[key as keyof ManualExpenseValues] = issue.message;
      }
    }
    return { ok: false, values, errors };
  }

  const repos = await getRepositories();
  const company = await loadCompanyContext(repos);
  if (!company.active) {
    return {
      ok: false,
      values,
      errors: { merchant: "会社が登録されていません" },
    };
  }

  const input = parsed.data;
  let category: ExpenseCategory = "要確認";
  if (isExpenseCategory(input.category)) {
    category = input.category;
  } else {
    // 未選択のときは、過去に確定した同じ利用先の費目を引き継ぐ
    const rule = await repos.merchantRules.get(
      normalizeMerchant(input.merchant),
    );
    if (rule) category = rule.category;
  }

  await repos.expenses.create({
    issuerId: company.active.id,
    date: input.date,
    merchant: input.merchant,
    amount: input.amount,
    category,
    source: "手入力",
    note: input.note,
  });
  revalidatePath("/expenses");
  return { ok: true };
}

export async function removeExpense(id: string): Promise<void> {
  await assertSession();
  const repos = await getRepositories();
  await repos.expenses.remove(id);
  revalidatePath("/expenses");
}
