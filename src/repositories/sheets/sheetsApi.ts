import { cache } from "react";
import { callGateway, type GatewayCall } from "@/lib/gateway";
import { createCoalescedFetcher } from "@/lib/coalesce";
import { SHEET_NAMES, TABLES } from "./schema";

const HEADERS = new Map(TABLES.map((table) => [table.name, table.header]));

/**
 * ほとんどの画面が使う小さい表。どれか 1 つを読むときに、残りも同じ通信で読んでおく。
 * 窓口への通信は 1 回ごとに時間がかかるので、画面 1 枚あたりの回数を減らすため。
 */
const SMALL_TABS: ReadonlySet<string> = new Set([
  SHEET_NAMES.issuers,
  SHEET_NAMES.parties,
  SHEET_NAMES.documents,
  SHEET_NAMES.settings,
  SHEET_NAMES.users,
  SHEET_NAMES.userProfiles,
  SHEET_NAMES.userSecurity,
  SHEET_NAMES.userAccess,
  SHEET_NAMES.sessionVersions,
]);

/**
 * 足りないタブを作る操作。新しい実行環境が最初に窓口を呼ぶときに 1 回だけ、
 * 本来の操作と同じ通信に載せる（通信を増やさないため）。
 */
let tabsEnsured = false;

/** この実行環境から書き込んだ回数。書き込みのあとは、読み取りの使い回しをやめる目印にする。 */
let writes = 0;

/** 窓口へ操作を送る。表の読み書きも帳票のタブの操作も、ここを通す。 */
export async function sendToSheet<T extends unknown[]>(
  calls: GatewayCall[],
): Promise<T> {
  const isWrite = calls.some((call) => call.op !== "read");
  if (isWrite) writes++;
  try {
    if (tabsEnsured) return await callGateway<T>(calls);
    const ensure: GatewayCall = {
      op: "ensureTabs",
      tabs: TABLES.map((table) => ({
        name: table.name,
        header: [...table.header],
      })),
    };
    const [, ...results] = await callGateway([ensure, ...calls]);
    tabsEnsured = true;
    return results as T;
  } finally {
    if (isWrite) writes++;
  }
}

/** 行を、見出しの列数までそろえる（空のセルは返ってこないため）。見出し行は除く。 */
function padRows(sheetName: string, values: string[][]): string[][] {
  const colCount = HEADERS.get(sheetName)?.length ?? 26;
  return values.slice(1).map((row) => {
    const padded = [...row];
    while (padded.length < colCount) padded.push("");
    return padded;
  });
}

/** 同じ瞬間に出された読み取りは、窓口への 1 回の通信にまとめる（coalesce.ts 参照）。 */
const readTab = createCoalescedFetcher<string[][]>(
  async (names) => {
    const [tables] = await sendToSheet<[Record<string, string[][] | null>]>([
      { op: "read", tabs: names },
    ]);
    return new Map(
      names.map((name) => [name, padRows(name, tables[name] ?? [])]),
    );
  },
  (rows) => rows.map((row) => [...row]),
);

/**
 * 1 回の要求（画面 1 枚の描画）の中では、同じ表を 1 度だけ読む。
 * React の cache は要求ごとに捨てられるので、ほかの人の書き込みが見えなくなるのは、その要求の中だけ。
 * 自分が書き込んだあとは writes が変わるので、読み直す。
 */
const readTabOnce = cache((key: string): Promise<string[][]> =>
  readTab(key.slice(key.indexOf(":") + 1)),
);

/** 使い回しの鍵。書き込みの回数を含めるので、書き込みのあとは別の鍵になる。 */
function onceKey(sheetName: string): string {
  return `${writes}:${sheetName}`;
}

export function readAll(sheetName: string): Promise<string[][]> {
  if (SMALL_TABS.has(sheetName)) {
    for (const other of SMALL_TABS) {
      if (other !== sheetName) readTabOnce(onceKey(other)).catch(() => {});
    }
  }
  return readTabOnce(onceKey(sheetName));
}

export async function appendRow(
  sheetName: string,
  row: string[],
): Promise<void> {
  await appendRows(sheetName, [row]);
}

/** 複数行を 1 回の通信で追加する。 */
export async function appendRows(
  sheetName: string,
  rows: string[][],
): Promise<void> {
  if (rows.length === 0) return;
  await sendToSheet([{ op: "append", tab: sheetName, rows }]);
}

/** id（1 列目）が一致する行を上書きする。行は窓口がロックの中で探す。 */
export async function updateRowById(
  sheetName: string,
  id: string,
  row: string[],
): Promise<void> {
  await sendToSheet([{ op: "updateById", tab: sheetName, id, row }]);
}

/** id（1 列目）が一致する行があれば上書きし、無ければ末尾に足す。 */
export async function upsertRowById(
  sheetName: string,
  id: string,
  row: string[],
): Promise<void> {
  await sendToSheet([{ op: "upsertById", tab: sheetName, id, row }]);
}

/** id（1 列目）が一致する行を消す。既に無ければ何もしない。 */
export async function deleteRowById(
  sheetName: string,
  id: string,
): Promise<void> {
  await sendToSheet([{ op: "deleteById", tab: sheetName, id }]);
}

/**
 * 採番カウンターを1つ進めて次の連番を返す。
 *
 * 窓口がロックの中で「保存値と floor の大きい方 + 1」を書くので、同時に作成しても同じ番号にならない。
 * key は会社ごとに独立している（`<issuerId>:<帳票種別>`）。行がまだ無ければ、
 * floor（既存帳票の最大番号）から続きを振る。
 */
export async function incrementCounter(
  key: string,
  floor = 0,
): Promise<number> {
  const [{ seq }] = await sendToSheet<[{ seq: number }]>([
    { op: "nextSeq", tab: SHEET_NAMES.counters, key, floor },
  ]);
  return seq;
}

/** 任意のタブで nextSeq を呼ぶ（auth_counters など）。 */
export async function nextSeqIn(
  tab: string,
  key: string,
  floor = 0,
): Promise<number> {
  const [{ seq }] = await sendToSheet<[{ seq: number }]>([
    { op: "nextSeq", tab, key, floor },
  ]);
  return seq;
}

/** 複数の鍵を 1 回の通信で進める。結果は鍵と同じ順。 */
export async function nextSeqMany(
  tab: string,
  keys: string[],
): Promise<number[]> {
  if (keys.length === 0) return [];
  const results = await sendToSheet<Array<{ seq: number }>>(
    keys.map((key) => ({ op: "nextSeq", tab, key, floor: 0 }) as const),
  );
  return results.map((result) => result.seq);
}
