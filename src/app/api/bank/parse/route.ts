import type { NextRequest } from "next/server";
import { z } from "zod";
import { getRepositories } from "@/repositories";
import { detectColumns, parseCsv } from "@/domain/bank";
import { readBankCsv } from "@/lib/bank-classifier";

export const runtime = "nodejs";
export const maxDuration = 60;

const bodySchema = z.object({ text: z.string().min(1).max(5_000_000) });

/**
 * 銀行 CSV を読み取り、まだ取り込んでいない取引だけを返す（科目の判断は /classify）。
 * 列の判定は見出しの語句で行い、決まらなければ Jev に聞く。
 */
export async function POST(req: NextRequest): Promise<Response> {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: "CSV の内容が空か、大きすぎます" },
      { status: 400 },
    );
  }

  const csvRows = parseCsv(parsed.data.text);
  const result = await readBankCsv(csvRows, detectColumns(csvRows));
  if (!result || result.rows.length === 0) {
    return Response.json(
      {
        error:
          "取引を読み取れませんでした。日付と金額（または入金・出金）の列がある銀行の明細 CSV か確認してください",
      },
      { status: 422 },
    );
  }

  const repos = await getRepositories();
  const known = new Set(
    (await repos.bankTransactions.list()).map((t) => t.key),
  );
  const rows = result.rows.filter((r) => !known.has(r.key));
  return Response.json({
    rows,
    total: result.rows.length,
    duplicates: result.rows.length - rows.length,
    skipped: result.skipped,
  });
}
