import { getRepositories } from "@/repositories";
import { sendWebPush, type VapidDetails } from "./webpush.ts";

const SETTINGS_KEY = "push_subscriptions";

function vapidDetails(): VapidDetails {
  const subject = process.env.VAPID_SUBJECT;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!subject || !publicKey || !privateKey) {
    throw new Error(
      "VAPID環境変数が未設定です（VAPID_SUBJECT / VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY）",
    );
  }
  return { subject, publicKey, privateKey };
}

export interface StoredSubscription {
  endpoint: string;
  expirationTime: number | null;
  keys: {
    p256dh: string;
    auth: string;
  };
}

export interface SendPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

export interface SendResult {
  sent: number;
  removed: number;
}

/** 404 / 410 は、購読がブラウザ側で失効して二度と届かないことを表す。 */
function isWebPushGoneError(e: unknown): boolean {
  if (typeof e !== "object" || e === null || !("statusCode" in e)) return false;
  return e.statusCode === 404 || e.statusCode === 410;
}

async function readSubscriptions(): Promise<StoredSubscription[]> {
  const repos = await getRepositories();
  const raw = await repos.settings.get(SETTINGS_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as StoredSubscription[];
  } catch {
    return [];
  }
}

async function writeSubscriptions(subs: StoredSubscription[]): Promise<void> {
  const repos = await getRepositories();
  await repos.settings.set(SETTINGS_KEY, JSON.stringify(subs));
}

export async function addSubscription(sub: StoredSubscription): Promise<void> {
  const subs = await readSubscriptions();
  const exists = subs.some((s) => s.endpoint === sub.endpoint);
  if (!exists) {
    subs.push(sub);
    await writeSubscriptions(subs);
  }
}

export async function removeSubscription(endpoint: string): Promise<void> {
  const subs = await readSubscriptions();
  const filtered = subs.filter((s) => s.endpoint !== endpoint);
  if (filtered.length !== subs.length) {
    await writeSubscriptions(filtered);
  }
}

/** 全購読へ送る。失効した購読は削除し、それ以外の送信失敗は数えずに無視する。 */
export async function sendToAll(payload: SendPayload): Promise<SendResult> {
  const vapid = vapidDetails();
  const subs = await readSubscriptions();
  let sent = 0;
  let removed = 0;
  const toRemove: string[] = [];

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await sendWebPush(sub, JSON.stringify(payload), vapid);
        sent++;
      } catch (e: unknown) {
        if (isWebPushGoneError(e)) {
          toRemove.push(sub.endpoint);
          removed++;
        }
      }
    }),
  );

  if (toRemove.length > 0) {
    const remaining = subs.filter((s) => !toRemove.includes(s.endpoint));
    await writeSubscriptions(remaining);
  }

  return { sent, removed };
}
