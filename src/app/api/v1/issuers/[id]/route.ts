import { authorizeApi, unauthorized } from "@/lib/api-auth";
import { parseIssuerPatch } from "@/lib/documents/agent-update";
import { getRepositories } from "@/repositories";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };

/**
 * 発行元の住所・連絡先・振込先を更新する。名称・既定・印影は変えられない。
 * 作成済みの書類の帳票には、書類を編集して作り直すまで反映されない。
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const repos = await getRepositories();
  if (!(await authorizeApi(request, repos))) return unauthorized();
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
  const patch = parseIssuerPatch(body);
  if (patch instanceof Error) {
    return Response.json({ ok: false, error: patch.message }, { status: 400 });
  }

  const { id } = await params;
  try {
    const current = await repos.issuers.get(id);
    if (!current)
      return Response.json(
        { ok: false, error: "issuer_not_found" },
        { status: 404 },
      );

    const updated = await repos.issuers.update(id, patch);
    return Response.json(
      {
        ok: true,
        issuer: {
          id: updated.id,
          name: updated.name,
          postalCode: updated.postalCode,
          address: updated.address,
          building: updated.building,
          phone: updated.phone,
          email: updated.email,
          registrationNumber: updated.registrationNumber,
          bankInfo: updated.bankInfo,
        },
      },
      { headers: NO_STORE },
    );
  } catch {
    return Response.json(
      { ok: false, error: "update_unavailable" },
      { status: 503 },
    );
  }
}
