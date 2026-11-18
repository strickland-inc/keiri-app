import { authorizeAgentRead } from "@/lib/agent-read-auth";
import { getAgentReadToken } from "@/lib/config";
import { loadMoneySnapshot } from "@/lib/money-snapshot-service";
import { getRepositories } from "@/repositories";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function currentMonthInTokyo(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  return `${year}-${month}`;
}

export async function GET(request: Request): Promise<Response> {
  if (
    !authorizeAgentRead(
      request.headers.get("authorization"),
      getAgentReadToken(),
    )
  ) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const month =
    url.searchParams.get("month") ?? currentMonthInTokyo(new Date());
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    return Response.json(
      { ok: false, error: "invalid_month" },
      { status: 400 },
    );
  }

  try {
    const repos = await getRepositories();
    const snapshot = await loadMoneySnapshot(repos, month);
    return Response.json(
      { ok: true, data: snapshot },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch {
    return Response.json(
      { ok: false, error: "snapshot_unavailable" },
      { status: 503 },
    );
  }
}
