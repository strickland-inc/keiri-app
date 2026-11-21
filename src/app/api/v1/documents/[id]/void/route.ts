import { authorizeApi, unauthorized } from "@/lib/api-auth";
import { canVoid } from "@/lib/documents/agent-update";
import { getRepositories } from "@/repositories";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };

/**
 * 書類を「無効」にする（削除はしない。番号は欠番として残る）。
 * 入金済みの書類と、すでに無効の書類は対象外。
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const repos = await getRepositories();
  if (!(await authorizeApi(request, repos))) return unauthorized();

  const { id } = await params;
  try {
    const doc = await repos.documents.get(id);
    if (!doc)
      return Response.json(
        { ok: false, error: "document_not_found" },
        { status: 404 },
      );
    if (!canVoid(doc.status)) {
      return Response.json(
        { ok: false, error: `状態「${doc.status}」の書類は無効にできません` },
        { status: 409 },
      );
    }

    const updated = await repos.documents.update(id, { status: "void" });
    return Response.json(
      {
        ok: true,
        id: updated.id,
        number: updated.number,
        status: updated.status,
      },
      { headers: NO_STORE },
    );
  } catch {
    return Response.json(
      { ok: false, error: "void_unavailable" },
      { status: 503 },
    );
  }
}
