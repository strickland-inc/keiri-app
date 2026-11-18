import { addSubscription } from "@/lib/push";
import type { StoredSubscription } from "@/lib/push";

export const runtime = "nodejs";

function isValidSubscription(v: unknown): v is StoredSubscription {
  if (typeof v !== "object" || v === null) return false;
  const obj = v as Record<string, unknown>;
  if (typeof obj.endpoint !== "string" || obj.endpoint === "") return false;
  if (typeof obj.keys !== "object" || obj.keys === null) return false;
  const keys = obj.keys as Record<string, unknown>;
  if (typeof keys.p256dh !== "string" || typeof keys.auth !== "string")
    return false;
  return true;
}

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!isValidSubscription(body)) {
    return Response.json({ error: "Invalid subscription" }, { status: 400 });
  }

  const sub: StoredSubscription = {
    endpoint: body.endpoint,
    expirationTime:
      typeof body.expirationTime === "number" ? body.expirationTime : null,
    keys: {
      p256dh: (body.keys as { p256dh: string }).p256dh,
      auth: (body.keys as { auth: string }).auth,
    },
  };

  await addSubscription(sub);
  return Response.json({ ok: true });
}
