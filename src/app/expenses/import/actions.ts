"use server";

import { assertSession } from "@/lib/session";
import { recordAudit } from "@/lib/audit";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getRepositories } from "@/repositories";
import { companyScope, loadCompanyContext } from "@/lib/active-company";
import { EXPENSE_CATEGORIES, type ExpenseCategory } from "@/domain/expense";
import { classifyExpense, type ClassifyMethod } from "@/domain/expense-rules";
import {
  expenseDedupKey,
  parseExpenseCsv,
  type ExpenseCsvFormat,
} from "@/domain/expense-csv";
import { MAX_FILE_BYTES, MAX_IMPORT_ROWS } from "./limits";

export interface PreviewRow {
  date: string;
  merchant: string;
  amount: number;
  category: ExpenseCategory;
  method: ClassifyMethod;
}

export interface ImportPreview {
  format: ExpenseCsvFormat;
  /** 取り込める新規の行。最大 MAX_IMPORT_ROWS 件。 */
  rows: PreviewRow[];
  /** 新規の行の総数。rows より多ければ、残りは分けて取り込む。 */
  newTotal: number;
  /** 取込済み、または同じ CSV の中で重複していて飛ばす行数。 */
  duplicates: number;
  /** 返金・支払いや、読み取れず取り込まない行数。 */
  skipped: number;
}

export type PreviewResult =
  { ok: true; preview: ImportPreview } | { ok: false; error: string };

export type SaveResult =
  { ok: true; created: number } | { ok: false; error: string };

/** CSV を読み取り、費目を決めて、取り込む前の一覧を返す。保存はしない。 */
export async function previewExpenseCsv(
  formData: FormData,
): Promise<PreviewResult> {
  await assertSession();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "CSV ファイルを選んでください" };
  }
  if (file.size > MAX_FILE_BYTES) {
    return {
      ok: false,
      error: "ファイルが大きすぎます。月ごとなどに分けて取り込んでください",
    };
  }

  let parsed: ReturnType<typeof parseExpenseCsv>;
  try {
    parsed = parseExpenseCsv(new Uint8Array(await file.arrayBuffer()));
  } catch (e: unknown) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "CSV を読み取れませんでした",
    };
  }

  const repos = await getRepositories();
  const company = await loadCompanyContext(repos);
  const [existing, rules] = await Promise.all([
    repos.expenses.list(companyScope(company)),
    repos.merchantRules.all(),
  ]);
  const seen = new Set(existing.map(expenseDedupKey));
  const learned = new Map(rules.map((r) => [r.key, r.category]));

  const fresh: PreviewRow[] = [];
  let duplicates = 0;
  for (const row of parsed.rows) {
    const key = expenseDedupKey(row);
    if (seen.has(key)) {
      duplicates++;
      continue;
    }
    seen.add(key);
    fresh.push({ ...row, ...classifyExpense(row, learned) });
  }

  return {
    ok: true,
    preview: {
      format: parsed.format,
      rows: fresh.slice(0, MAX_IMPORT_ROWS),
      newTotal: fresh.length,
      duplicates,
      skipped: parsed.skipped,
    },
  };
}

// ブラウザから届いた行は信じず、サーバー側で形と費目を確かめ直す
const saveSchema = z
  .array(
    z.object({
      date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .refine((v) => !Number.isNaN(Date.parse(v))),
      merchant: z.string().trim().min(1).max(200),
      amount: z.number().int().positive().max(1_000_000_000),
      category: z.enum(EXPENSE_CATEGORIES),
    }),
  )
  .min(1)
  .max(MAX_IMPORT_ROWS);

/** プレビューで見せた行を経費として保存する。bulkCreate は 1 回だけ呼ぶ。 */
export async function saveExpenseCsv(rows: unknown): Promise<SaveResult> {
  const session = await assertSession();
  const parsed = saveSchema.safeParse(rows);
  if (!parsed.success) {
    return {
      ok: false,
      error: `取り込む行が正しくありません。1 回に取り込めるのは ${MAX_IMPORT_ROWS} 行までです`,
    };
  }

  const repos = await getRepositories();
  const company = await loadCompanyContext(repos);
  if (!company.active) {
    return { ok: false, error: "会社が登録されていません" };
  }

  // 取り込むボタンの二度押しや、別の画面での取り込みで重複させないため、保存の直前にも確かめる
  const existing = await repos.expenses.list(companyScope(company));
  const seen = new Set(existing.map(expenseDedupKey));
  const fresh = parsed.data.filter((row) => {
    const key = expenseDedupKey(row);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (fresh.length > 0) {
    await repos.expenses.bulkCreate(
      fresh.map((row) => ({
        issuerId: company.active?.id,
        ...row,
        source: "CSV取込",
        note: "",
      })),
    );
    await recordAudit(
      session,
      "expense.imported",
      { type: "expense" },
      `経費 ${fresh.length} 件を CSV から取り込み`,
    );
  }
  revalidatePath("/expenses");
  return { ok: true, created: fresh.length };
}
