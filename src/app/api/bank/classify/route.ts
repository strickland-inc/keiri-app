import { currentSession } from "@/lib/session";
import { recordAudit } from "@/lib/audit";
import type { NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getRepositories } from "@/repositories";
import { classifyRows } from "@/lib/bank-classifier";
import { JevError } from "@/lib/jev";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_ROWS = 10;

const bodySchema = z.object({
  rows: z
    .array(
      z.object({
        key: z.string().min(1),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        seq: z.number().int(),
        description: z.string(),
        amount: z
          .number()
          .int()
          .refine((n) => n !== 0),
        balance: z.number().int().optional(),
      }),
    )
    .min(1)
    .max(MAX_ROWS),
});

/** 取引を Jev で仕訳して保存し、照合できた請求書を入金済みにする。 */
export async function POST(req: NextRequest): Promise<Response> {
  const session = await currentSession();
  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: `一度に処理できるのは ${MAX_ROWS} 件までです` },
      { status: 400 },
    );
  }

  try {
    const repos = await getRepositories();
    const [existing, invoices, parties] = await Promise.all([
      repos.bankTransactions.list(),
      repos.documents.list({ type: "invoice" }),
      repos.parties.list(),
    ]);
    const result = await classifyRows(parsed.data.rows, {
      existing,
      invoices,
      partyNames: new Map(parties.map((p) => [p.id, p.name])),
    });

    await repos.bankTransactions.bulkCreate(result.created);
    for (const id of result.matchedDocumentIds) {
      await repos.documents.update(id, { status: "paid" });
    }

    if (result.created.length > 0) {
      await recordAudit(
        session,
        "bank.imported",
        { type: "bank_transaction" },
        `銀行明細 ${result.created.length} 件を取り込み（請求書 ${result.matchedDocumentIds.length} 件を入金済みに）`,
      );
    }
    revalidatePath("/bank");
    revalidatePath("/documents");
    revalidatePath("/");
    return Response.json({
      created: result.created.length,
      duplicates: result.duplicates,
      matched: result.matchedDocumentIds.length,
      review: result.created.filter((t) => t.needsReview).length,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "仕訳に失敗しました";
    return Response.json(
      { error: message },
      { status: e instanceof JevError ? 502 : 500 },
    );
  }
}
