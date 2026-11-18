import { cookies } from "next/headers";
import { verifySession, SESSION_COOKIE } from "@/lib/auth";
import { getRepositories } from "@/repositories";
import { sendToAll } from "@/lib/push";
import { toIsoDate } from "@/domain/dates";
import {
  type DateRange,
  periodSummary,
  merchantRanking,
  lastWeekRange,
  thisMonthRange,
  lastMonthRange,
  changeRate,
} from "@/domain/reports";
import { formatYen } from "@/domain/money";

export const runtime = "nodejs";

type SendType = "weekly" | "monthly" | "test";

interface SendBody {
  type: SendType;
  title?: string;
  body?: string;
  range?: DateRange;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const REPORT_TIME_ZONE = "Asia/Tokyo";

function isValidSendType(v: unknown): v is SendType {
  return v === "weekly" || v === "monthly" || v === "test";
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function isDateRange(v: unknown): v is DateRange {
  if (!isRecord(v)) return false;
  if (!("from" in v) || !("to" in v)) return false;

  const { from, to } = v;
  return (
    typeof from === "string" &&
    typeof to === "string" &&
    isIsoDateString(from) &&
    isIsoDateString(to) &&
    from <= to
  );
}

function parseIsoDate(iso: string): Date {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function isIsoDateString(value: string): boolean {
  if (!ISO_DATE_RE.test(value)) return false;
  return toIsoDate(parseIsoDate(value)) === value;
}

function dateInTimeZone(date: Date, timeZone: string): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const day = Number(parts.find((part) => part.type === "day")?.value);

  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day)
  ) {
    throw new Error("Failed to resolve report date");
  }

  return new Date(year, month - 1, day);
}

async function isAuthenticated(): Promise<boolean> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  return session !== null;
}

export async function POST(req: Request): Promise<Response> {
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!isRecord(rawBody)) {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }

  const obj = rawBody;

  if (!isValidSendType(obj.type)) {
    return Response.json(
      { error: "type must be weekly | monthly | test" },
      { status: 400 },
    );
  }

  if (obj.range !== undefined && !isDateRange(obj.range)) {
    return Response.json(
      { error: "range must be { from: YYYY-MM-DD, to: YYYY-MM-DD }" },
      { status: 400 },
    );
  }

  // test は共有シークレットかログイン済みセッション、weekly / monthly は共有シークレットのみ許可する
  const type = obj.type;
  const expectedSecret = process.env.PUSH_SECRET;
  const providedSecret = req.headers.get("x-push-secret") ?? obj.secret;

  if (type === "test") {
    const secretValid = expectedSecret && providedSecret === expectedSecret;
    if (!secretValid) {
      if (!(await isAuthenticated())) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
      }
    }
  } else {
    if (!expectedSecret || providedSecret !== expectedSecret) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const sendBody: SendBody = {
    type,
    title: typeof obj.title === "string" ? obj.title : undefined,
    body: typeof obj.body === "string" ? obj.body : undefined,
    range: isDateRange(obj.range) ? obj.range : undefined,
  };

  let notifTitle: string;
  let notifBody: string;

  if (sendBody.type === "test") {
    notifTitle = sendBody.title ?? "KEIRI テスト通知";
    notifBody = sendBody.body ?? "Web Push の動作確認です。";
  } else {
    const repos = await getRepositories();
    const expenses = await repos.expenses.list();
    const today = dateInTimeZone(new Date(), REPORT_TIME_ZONE);

    const range =
      sendBody.type === "weekly"
        ? (sendBody.range ?? lastWeekRange(today))
        : thisMonthRange(today);
    const prevRange =
      sendBody.type === "weekly"
        ? lastWeekRange(parseIsoDate(range.from))
        : lastMonthRange(today);

    const summary = periodSummary(expenses, range);
    const prevSummary = periodSummary(expenses, prevRange);
    const rate = changeRate(summary.total, prevSummary.total);

    const ranking = merchantRanking({ expenses, range, limit: 3 });
    const top3 = ranking.byCount
      .slice(0, 3)
      .map((m) => m.merchant)
      .join("・");

    const periodLabel = sendBody.type === "weekly" ? "先週" : "今月";
    const rateStr =
      rate == null
        ? ""
        : `、前期間比${rate >= 0 ? "+" : ""}${Math.round(rate)}%`;

    notifTitle = `${periodLabel}の経費レポート`;
    notifBody = `${periodLabel}: ${formatYen(summary.total)}（${summary.count}件）${rateStr}${top3 ? `。よく使った: ${top3}` : ""}`;
  }

  const result = await sendToAll({
    title: notifTitle,
    body: notifBody,
    url: "/",
    tag: `report-${sendBody.type}`,
  });

  return Response.json(result);
}
