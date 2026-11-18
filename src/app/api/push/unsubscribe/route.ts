import { removeSubscription } from "@/lib/push";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (
    typeof body !== "object" ||
    body === null ||
    typeof (body as Record<string, unknown>).endpoint !== "string" ||
    (body as Record<string, unknown>).endpoint === ""
  ) {
    return Response.json({ error: "endpoint is required" }, { status: 400 });
  }

  const { endpoint } = body as { endpoint: string };
  await removeSubscription(endpoint);
  return Response.json({ ok: true });
}
