/**
 * Google Sheets / Drive の最小 REST クライアント。サービスアカウントの JWT を Web Crypto で署名し、
 * `fetch` だけで通信する（googleapis は Node 専用で重く、Cloudflare Workers で動かせないため）。
 * 呼び出し形は googleapis（`{ data }` を返す）に寄せてあり、使う API だけを実装している。
 */
import { requireSheetsConfig } from "../config.ts";

export const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SHEETS_BASE = "https://sheets.googleapis.com/v4/spreadsheets";
const DRIVE_BASE = "https://www.googleapis.com/drive/v3/files";

// ── 認証 ──────────────────────────────────────────────────────────────────────

function base64Url(bytes: Uint8Array | string): string {
  const raw =
    typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  let binary = "";
  for (const b of raw) binary += String.fromCharCode(b);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function pemToDer(pem: string): Uint8Array {
  const body = pem
    .replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  return Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
}

async function signJwt(
  email: string,
  privateKeyPem: string,
  scope: string,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64Url(
    JSON.stringify({
      iss: email,
      scope,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    }),
  );
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToDer(privateKeyPem) as BufferSource,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(`${header}.${claims}`),
  );
  return `${header}.${claims}.${base64Url(new Uint8Array(signature))}`;
}

const tokenCache = new Map<string, { token: string; expiresAt: number }>();

/** アクセストークンを返す。有効なものは使い回す（通信回数を減らすため）。 */
export async function getAccessToken(
  scopes: readonly string[],
): Promise<string> {
  const scope = scopes.join(" ");
  const cached = tokenCache.get(scope);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  const { email, key } = requireSheetsConfig();
  // .env では改行を \n でエスケープして持つため復元する。
  const assertion = await signJwt(email, key.replace(/\\n/g, "\n"), scope);
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!res.ok) {
    throw new Error(
      `Google の認証に失敗しました (${res.status})。サービスアカウントの設定を確認してください`,
    );
  }
  const data = (await res.json()) as {
    access_token: string;
    expires_in: number;
  };
  tokenCache.set(scope, {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  });
  return data.access_token;
}

// ── 共通の呼び出し ────────────────────────────────────────────────────────────

async function call<T>(
  scopes: readonly string[],
  url: string,
  init: {
    method?: string;
    /** 値が配列のキーは、同じ名前で繰り返して付ける（例: ranges=a&ranges=b）。 */
    query?: Record<string, string | boolean | readonly string[] | undefined>;
    body?: unknown;
  } = {},
): Promise<{ data: T }> {
  const target = new URL(url);
  for (const [k, v] of Object.entries(init.query ?? {})) {
    if (v === undefined) continue;
    if (typeof v === "object")
      for (const item of v) target.searchParams.append(k, item);
    else target.searchParams.set(k, String(v));
  }
  const res = await fetch(target, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${await getAccessToken(scopes)}`,
      ...(init.body !== undefined
        ? { "Content-Type": "application/json" }
        : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    throw new Error(`Google API エラー (${res.status}): ${detail}`);
  }
  return { data: (await res.json()) as T };
}

// ── Sheets v4 ─────────────────────────────────────────────────────────────────

export interface SheetProperties {
  sheetId?: number;
  title?: string;
}
export interface GridRange {
  sheetId?: number;
  startRowIndex?: number;
  endRowIndex?: number;
  startColumnIndex?: number;
  endColumnIndex?: number;
}
export interface Spreadsheet {
  properties?: { title?: string };
  sheets?: Array<{ properties?: SheetProperties; merges?: GridRange[] }>;
}
export interface BatchGetResponse {
  valueRanges?: Array<{ range?: string; values?: string[][] }>;
}
export interface BatchUpdateResponse {
  replies?: Array<{ addSheet?: { properties?: SheetProperties } }>;
}

const enc = encodeURIComponent;

/** googleapis の `google.sheets({ version: "v4" })` と同じ形で使える最小クライアント。 */
export function createSheetsApi(scopes: readonly string[] = [SHEETS_SCOPE]) {
  return {
    spreadsheets: {
      get: (p: { spreadsheetId: string; includeGridData?: boolean }) =>
        call<Spreadsheet>(scopes, `${SHEETS_BASE}/${enc(p.spreadsheetId)}`, {
          query: { includeGridData: p.includeGridData },
        }),
      batchUpdate: (p: {
        spreadsheetId: string;
        requestBody: { requests: unknown[] };
      }) =>
        call<BatchUpdateResponse>(
          scopes,
          `${SHEETS_BASE}/${enc(p.spreadsheetId)}:batchUpdate`,
          {
            method: "POST",
            body: p.requestBody,
          },
        ),
      values: {
        get: (p: { spreadsheetId: string; range: string }) =>
          call<{ values?: string[][] }>(
            scopes,
            `${SHEETS_BASE}/${enc(p.spreadsheetId)}/values/${enc(p.range)}`,
          ),
        /** 複数の範囲を 1 回の通信で読む（返る順番は ranges と同じ）。 */
        batchGet: (p: { spreadsheetId: string; ranges: readonly string[] }) =>
          call<BatchGetResponse>(
            scopes,
            `${SHEETS_BASE}/${enc(p.spreadsheetId)}/values:batchGet`,
            {
              query: { ranges: p.ranges },
            },
          ),
        update: (p: {
          spreadsheetId: string;
          range: string;
          valueInputOption: "RAW" | "USER_ENTERED";
          requestBody: { values: unknown[][] };
        }) =>
          call<unknown>(
            scopes,
            `${SHEETS_BASE}/${enc(p.spreadsheetId)}/values/${enc(p.range)}`,
            {
              method: "PUT",
              query: { valueInputOption: p.valueInputOption },
              body: p.requestBody,
            },
          ),
        append: (p: {
          spreadsheetId: string;
          range: string;
          valueInputOption: "RAW" | "USER_ENTERED";
          requestBody: { values: unknown[][] };
        }) =>
          call<unknown>(
            scopes,
            `${SHEETS_BASE}/${enc(p.spreadsheetId)}/values/${enc(p.range)}:append`,
            {
              method: "POST",
              query: { valueInputOption: p.valueInputOption },
              body: p.requestBody,
            },
          ),
      },
      sheets: {
        copyTo: (p: {
          spreadsheetId: string;
          sheetId: number;
          requestBody: { destinationSpreadsheetId: string };
        }) =>
          call<SheetProperties>(
            scopes,
            `${SHEETS_BASE}/${enc(p.spreadsheetId)}/sheets/${p.sheetId}:copyTo`,
            { method: "POST", body: p.requestBody },
          ),
      },
    },
  };
}

// ── Drive v3 ──────────────────────────────────────────────────────────────────

export function getDriveFile(fileId: string) {
  return call<{ id?: string; name?: string; webViewLink?: string }>(
    [SHEETS_SCOPE, DRIVE_SCOPE],
    `${DRIVE_BASE}/${enc(fileId)}`,
    { query: { fields: "id,name,webViewLink", supportsAllDrives: true } },
  );
}

/** スプレッドシートの 1 シートを PDF として書き出す（Google 側で変換するので CPU を使わない）。 */
export async function exportSheetAsPdf(url: URL): Promise<Uint8Array> {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${await getAccessToken([SHEETS_SCOPE, DRIVE_SCOPE])}`,
    },
  });
  if (!res.ok) throw new Error(`PDF の書き出しに失敗しました (${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}
