import { authorizeAgentRead } from "@/lib/agent-read-auth";
import { getAgentDocumentsToken } from "@/lib/config";
import { createDocumentWithTemplate } from "@/lib/documents/create";
import { parseAgentDocumentRequest } from "@/lib/documents/agent-request";
import { getRepositories } from "@/repositories";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };

function isAuthorized(request: Request): boolean {
  return authorizeAgentRead(
    request.headers.get("authorization"),
    getAgentDocumentsToken(),
  );
}

/** 取引先・発行元・直近の書類を返す（請求書を作る前の下調べ用）。 */
export async function GET(request: Request): Promise<Response> {
  if (!isAuthorized(request)) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  try {
    const repos = await getRepositories();
    const [parties, issuers, documents] = await Promise.all([
      repos.parties.list(),
      repos.issuers.list(),
      repos.documents.list(),
    ]);
    return Response.json(
      {
        ok: true,
        data: {
          parties: parties.map((p) => ({
            id: p.id,
            name: p.name,
            honorific: p.honorific,
          })),
          // 住所・振込先の値は返さない。請求書に必要な項目が入っているかだけ分かるようにする。
          issuers: issuers.map((i) => ({
            id: i.id,
            name: i.name,
            isDefault: Boolean(i.isDefault),
            hasAddress: Boolean(i.address),
            hasBankInfo: Boolean(i.bankInfo),
          })),
          documents: documents.map((d) => ({
            id: d.id,
            issuerId: d.issuerId,
            type: d.type,
            number: d.number,
            issueDate: d.issueDate,
            dueDate: d.dueDate,
            partyId: d.partyId,
            title: d.title,
            status: d.status,
            items: d.items,
          })),
        },
      },
      { headers: NO_STORE },
    );
  } catch {
    return Response.json({ ok: false, error: "unavailable" }, { status: 503 });
  }
}

/**
 * 書類を作る。`?dryRun=1` なら保存せず、解釈した内容だけ返す。
 * 同じ会社・種類・取引先・発行日・件名の書類が既にあれば、作らずに既存の id を返す。
 */
export async function POST(request: Request): Promise<Response> {
  if (!isAuthorized(request)) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (
    request.headers.get("content-type")?.split(";", 1)[0] !== "application/json"
  ) {
    return Response.json(
      { ok: false, error: "content_type_required" },
      { status: 415 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  try {
    const repos = await getRepositories();
    const [parties, issuers, existing] = await Promise.all([
      repos.parties.list(),
      repos.issuers.list(),
      repos.documents.list(),
    ]);
    const parsed = parseAgentDocumentRequest(body, {
      parties,
      issuers,
      existing,
    });
    if (parsed instanceof Error) {
      return Response.json(
        { ok: false, error: parsed.message },
        { status: 400 },
      );
    }

    const dryRun = new URL(request.url).searchParams.get("dryRun") === "1";
    const results = [];
    for (const item of parsed) {
      if (!item.ok) {
        results.push({ index: item.index, ok: false, error: item.error });
      } else if (item.duplicateOf) {
        results.push({
          index: item.index,
          ok: true,
          created: false,
          duplicateOf: item.duplicateOf,
        });
      } else if (dryRun) {
        results.push({
          index: item.index,
          ok: true,
          created: false,
          preview: item.input,
        });
      } else {
        const doc = await createDocumentWithTemplate(repos, item.input);
        results.push({
          index: item.index,
          ok: true,
          created: true,
          id: doc.id,
          number: doc.number,
          url: `/documents/${doc.id}`,
        });
      }
    }
    return Response.json({ ok: true, dryRun, results }, { headers: NO_STORE });
  } catch {
    return Response.json(
      { ok: false, error: "create_unavailable" },
      { status: 503 },
    );
  }
}
