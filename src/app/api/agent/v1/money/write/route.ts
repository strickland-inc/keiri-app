import { authorizeAgentRead } from "@/lib/agent-read-auth";
import { getAgentWriteToken } from "@/lib/config";
import {
  executeMoneyWrite,
  type MoneyWriteRequest,
} from "@/lib/money-write-service";
import { getRepositories } from "@/repositories";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(error: unknown): Response {
  const code = error instanceof Error ? error.message : "";
  if (code === "stale_expense" || code === "stale_money_plan") {
    return Response.json({ ok: false, error: code }, { status: 409 });
  }
  if (
    code === "expense_not_found" ||
    code === "money_plan_not_found" ||
    code === "commitment_not_found"
  ) {
    return Response.json({ ok: false, error: code }, { status: 404 });
  }
  const safeValidationErrors = new Set([
    "invalid_write_request",
    "invalid_expense_update",
    "invalid_expense_patch",
    "invalid_commitment_update",
    "cancellation_evidence_required",
    "idempotency_payload_mismatch",
  ]);
  if (safeValidationErrors.has(code)) {
    return Response.json({ ok: false, error: code }, { status: 400 });
  }
  return Response.json(
    { ok: false, error: "write_unavailable" },
    { status: 503 },
  );
}

export async function POST(request: Request): Promise<Response> {
  if (
    !authorizeAgentRead(
      request.headers.get("authorization"),
      getAgentWriteToken(),
    )
  ) {
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
  try {
    const body = (await request.json()) as MoneyWriteRequest;
    const repositories = await getRepositories();
    const result = await executeMoneyWrite(repositories, body);
    return Response.json(
      { ok: true, data: result },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
