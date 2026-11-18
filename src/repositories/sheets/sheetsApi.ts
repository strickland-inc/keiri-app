import { getSheetsClient, getSpreadsheetId } from "@/lib/sheets/client";
import {
  SHEET_NAMES,
  DOCUMENTS_HEADERS,
  PARTIES_HEADERS,
  ISSUERS_HEADERS,
  USERS_HEADERS,
  COUNTERS_HEADERS,
  EXPENSES_HEADERS,
  SETTINGS_HEADERS,
  MERCHANT_RULES_HEADERS,
  BANK_TRANSACTIONS_HEADERS,
  REVENUES_HEADERS,
} from "./schema";
import { DOCUMENT_TYPES } from "@/domain/documents";
import { createCoalescedFetcher } from "@/lib/coalesce";
import { nextSequence } from "../scope";

// シートごとの列数。API が返す疎な行を、この列数まで空文字で埋めるのに使う。
const SHEET_COL_COUNTS: { [k: string]: number | undefined } = {
  [SHEET_NAMES.documents]: DOCUMENTS_HEADERS.length,
  [SHEET_NAMES.parties]: PARTIES_HEADERS.length,
  [SHEET_NAMES.issuers]: ISSUERS_HEADERS.length,
  [SHEET_NAMES.users]: USERS_HEADERS.length,
  [SHEET_NAMES.counters]: COUNTERS_HEADERS.length,
  [SHEET_NAMES.expenses]: EXPENSES_HEADERS.length,
  [SHEET_NAMES.settings]: SETTINGS_HEADERS.length,
  [SHEET_NAMES.merchantRules]: MERCHANT_RULES_HEADERS.length,
  [SHEET_NAMES.bankTransactions]: BANK_TRANSACTIONS_HEADERS.length,
  [SHEET_NAMES.revenues]: REVENUES_HEADERS.length,
};

const SHEET_HEADER_ROWS: { [k: string]: readonly string[] | undefined } = {
  [SHEET_NAMES.documents]: DOCUMENTS_HEADERS,
  [SHEET_NAMES.parties]: PARTIES_HEADERS,
  [SHEET_NAMES.issuers]: ISSUERS_HEADERS,
  [SHEET_NAMES.users]: USERS_HEADERS,
  [SHEET_NAMES.counters]: COUNTERS_HEADERS,
  [SHEET_NAMES.expenses]: EXPENSES_HEADERS,
  [SHEET_NAMES.settings]: SETTINGS_HEADERS,
  [SHEET_NAMES.merchantRules]: MERCHANT_RULES_HEADERS,
  [SHEET_NAMES.bankTransactions]: BANK_TRANSACTIONS_HEADERS,
  [SHEET_NAMES.revenues]: REVENUES_HEADERS,
};

// 数値の sheetId。行の削除（batchUpdate の deleteDimension）に必要で、_init で埋める。
const sheetIds = new Map<string, number>();

// ensureSheets は _init を1回だけ走らせ、以降は同じ Promise を返す。
let ensurePromise: Promise<void> | null = null;

async function _init(): Promise<void> {
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  // 既存のタブを調べる。
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const existingSheets = meta.data.sheets ?? [];
  const existingTitles = new Set(
    existingSheets.map((sh) => sh.properties?.title ?? ""),
  );

  for (const sh of existingSheets) {
    const title = sh.properties?.title;
    const id = sh.properties?.sheetId;
    if (title && id != null) sheetIds.set(title, id);
  }

  // 無いタブを作る。
  const required = Object.values(SHEET_NAMES) as string[];
  const missing = required.filter((name) => !existingTitles.has(name));

  if (missing.length > 0) {
    const batchRes = await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: missing.map((name) => ({
          addSheet: { properties: { title: name } },
        })),
      },
    });
    const replies = batchRes.data.replies ?? [];
    missing.forEach((name, i) => {
      const newId = replies[i]?.addSheet?.properties?.sheetId;
      if (newId != null) sheetIds.set(name, newId);
    });

    // ヘッダー行を書くのは新規作成したタブだけ。既存タブのヘッダーは更新しない。
    for (const name of missing) {
      const headers = SHEET_HEADER_ROWS[name];
      if (headers) {
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: `${name}!A1`,
          valueInputOption: "RAW",
          requestBody: { values: [Array.from(headers)] },
        });
      }
    }
  }

  // 帳票種別ごとの旧形式のカウンター行を用意する（会社別のキーは incrementCounter が作る）。
  const counterRows = await readAll(SHEET_NAMES.counters);
  const existingTypes = new Set(counterRows.map((r) => r[0]));
  for (const docType of DOCUMENT_TYPES) {
    if (!existingTypes.has(docType)) {
      await appendRow(SHEET_NAMES.counters, [docType, "0"]);
    }
  }
}

export function ensureSheets(): Promise<void> {
  if (!ensurePromise) ensurePromise = _init();
  return ensurePromise;
}

// ── Sheets API の低水準ヘルパー ──────────────────────────────────────────────
// ensureSheets は呼ばない。呼び出し側（Repository のメソッド）が先に呼ぶこと。

/** 行を、見出しの列数までそろえる（空のセルは返ってこないため）。 */
function padRows(sheetName: string, values: string[][]): string[][] {
  const colCount = SHEET_COL_COUNTS[sheetName] ?? 26;
  // 先頭は見出し行なので除く
  return values.slice(1).map((row) => {
    const padded = [...row];
    while (padded.length < colCount) padded.push("");
    return padded;
  });
}

/**
 * 同じ瞬間に出された読み取りは、1 回の `values:batchGet` にまとめる
 * （通信 1 回ごとに Workers の CPU 時間を使うため。coalesce.ts 参照）。
 */
const readTab = createCoalescedFetcher<string[][]>(
  async (names) => {
    const res = await getSheetsClient().spreadsheets.values.batchGet({
      spreadsheetId: getSpreadsheetId(),
      ranges: names.map((name) => `${name}!A:Z`),
    });
    const ranges = res.data.valueRanges ?? [];
    return new Map(
      names.map((name, i) => [name, padRows(name, ranges[i]?.values ?? [])]),
    );
  },
  (rows) => rows.map((row) => [...row]),
);

export function readAll(sheetName: string): Promise<string[][]> {
  return readTab(sheetName);
}

export async function appendRow(
  sheetName: string,
  row: string[],
): Promise<void> {
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${sheetName}!A:A`,
    valueInputOption: "RAW",
    requestBody: { values: [row] },
  });
}

/** 複数行を 1 回の API 呼び出しで追加する。 */
export async function appendRows(
  sheetName: string,
  rows: string[][],
): Promise<void> {
  if (rows.length === 0) return;
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${sheetName}!A:A`,
    valueInputOption: "RAW",
    requestBody: { values: rows },
  });
}

export async function updateRowById(
  sheetName: string,
  id: string,
  row: string[],
): Promise<void> {
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  const allRows = await readAll(sheetName);
  const dataIdx = allRows.findIndex((r) => r[0] === id);
  if (dataIdx < 0) throw new Error(`Row not found: ${id} in ${sheetName}`);
  // ヘッダーがシートの1行目なので、データの先頭は2行目（1始まり）。
  const sheetRowNum = dataIdx + 2;
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${sheetName}!A${sheetRowNum}:Z${sheetRowNum}`,
    valueInputOption: "RAW",
    requestBody: { values: [row] },
  });
}

export async function deleteRowById(
  sheetName: string,
  id: string,
): Promise<void> {
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  const sheetId = sheetIds.get(sheetName);
  if (sheetId == null) throw new Error(`Sheet ID not cached for: ${sheetName}`);
  const allRows = await readAll(sheetName);
  const dataIdx = allRows.findIndex((r) => r[0] === id);
  if (dataIdx < 0) return; // 既に無いので何もしない
  // 0始まりのインデックスでは、ヘッダーが 0、データの先頭が 1。
  const sheetRowIndex = dataIdx + 1;
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId,
              dimension: "ROWS",
              startIndex: sheetRowIndex,
              endIndex: sheetRowIndex + 1,
            },
          },
        },
      ],
    },
  });
}

/**
 * 採番カウンターを1つ進めて次の連番を返す。
 *
 * key は会社ごとに独立している（`<issuerId>:<帳票種別>`）ため、行がまだ無いことが
 * 通常状態になる。その場合は `seedIfMissing`（既存帳票の最大番号）から続きを振る。
 * これで、会社スコープを導入する前に発行した番号と連続したまま移行できる。
 */
export async function incrementCounter(
  key: string,
  seedIfMissing = 0,
): Promise<number> {
  const counterRows = await readAll(SHEET_NAMES.counters);
  const row = counterRows.find((r) => r[0] === key);
  if (!row) {
    const next = nextSequence(0, seedIfMissing);
    await appendRow(SHEET_NAMES.counters, [key, String(next)]);
    return next;
  }
  const next = nextSequence(Number.parseInt(row[1] ?? "0", 10), seedIfMissing);
  await updateRowById(SHEET_NAMES.counters, key, [key, String(next)]);
  return next;
}
