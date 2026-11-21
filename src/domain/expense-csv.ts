/**
 * カード明細（CSV）を経費の行に読み取る純関数。楽天カードと PayPay は列の読み方が決まっており、
 * それ以外は見出しから 日付・利用先・金額 の列を推定する。文字コード・CSV の分割・日付と金額の
 * 読み取りは、銀行 CSV と同じ bank.ts の関数を使う。
 */
import { decodeText, parseAmount, parseCsv, parseDate } from "./bank.ts";

export type ExpenseCsvFormat = "rakuten" | "paypay" | "generic";

export interface ExpenseCsvRow {
  /** YYYY-MM-DD */
  date: string;
  merchant: string;
  /** 円・正の整数。 */
  amount: number;
}

export interface ParsedExpenseCsv {
  rows: ExpenseCsvRow[];
  /** 返金・支払い（金額 0 以下）や、日付・金額を読めず取り込まなかった行数。 */
  skipped: number;
  format: ExpenseCsvFormat;
}

interface Layout {
  headerRow: number;
  format: ExpenseCsvFormat;
  date: number;
  merchant: number;
  /** PayPay だけ、取引先が空のときの代わりに使う「取引内容」の列。 */
  kind?: number;
  amount: number;
}

/** 見出しを探す範囲。明細の前にカード名や期間の注記が付く CSV がある。 */
const HEADER_SEARCH_ROWS = 20;

const NOT_AMOUNT = /残高|手数料|ポイント|入金/;

function headerCells(row: readonly string[]): string[] {
  return row.map((c) => c.normalize("NFKC").replace(/\s/g, ""));
}

function indexOf(cells: readonly string[], pattern: RegExp): number {
  return cells.findIndex((c) => pattern.test(c));
}

function detectLayout(rows: readonly string[][]): Layout | null {
  for (let i = 0; i < Math.min(rows.length, HEADER_SEARCH_ROWS); i++) {
    const cells = headerCells(rows[i]);

    const paypayDate = indexOf(cells, /取引日/);
    const paypayAmount = indexOf(cells, /出金金額/);
    if (paypayDate >= 0 && paypayAmount >= 0) {
      return {
        headerRow: i,
        format: "paypay",
        date: paypayDate,
        merchant: indexOf(cells, /取引先/),
        kind: indexOf(cells, /取引内容/),
        amount: paypayAmount,
      };
    }

    if (
      indexOf(cells, /利用日/) >= 0 &&
      indexOf(cells, /利用店名/) >= 0 &&
      indexOf(cells, /利用金額/) >= 0
    ) {
      return {
        headerRow: i,
        format: "rakuten",
        date: indexOf(cells, /利用日|ご利用日/),
        merchant: indexOf(cells, /利用店名|ご利用先|商品名|利用先/),
        amount: indexOf(cells, /利用金額|ご利用金額|支払金額|金額/),
      };
    }

    const date = indexOf(cells, /日付|利用日|取引日|年月日|^日$|日時/);
    const merchant = indexOf(
      cells,
      /利用先|利用店|店名|加盟店|摘要|内容|取引先|支払先|商品名|名称|相手|利用場所/,
    );
    const amount = cells.findIndex(
      (c) => /金額|出金|支払額|請求額/.test(c) && !NOT_AMOUNT.test(c),
    );
    if (date >= 0 && merchant >= 0 && amount >= 0) {
      return { headerRow: i, format: "generic", date, merchant, amount };
    }
  }
  return null;
}

export function parseExpenseCsv(bytes: Uint8Array): ParsedExpenseCsv {
  const rows = parseCsv(decodeText(bytes));
  const layout = detectLayout(rows);
  if (!layout) {
    throw new Error(
      "日付・利用先・金額の列を見つけられませんでした。1行目に「利用日」「利用店名」「利用金額」のような見出しがあるカード明細の CSV を選んでください。",
    );
  }

  const out: ExpenseCsvRow[] = [];
  let skipped = 0;
  for (const row of rows.slice(layout.headerRow + 1)) {
    const date = parseDate(row[layout.date] ?? "");
    const amount = parseAmount(row[layout.amount] ?? "");
    let merchant = (row[layout.merchant] ?? "").trim();
    // PayPay は個人間送金などで取引先が空になる。取引内容を利用先の代わりにする
    if (layout.format === "paypay" && merchant === "") {
      merchant = (row[layout.kind ?? -1] ?? "").trim() || "PayPay";
    }
    if (date === null || amount === null || amount <= 0 || merchant === "") {
      skipped++;
      continue;
    }
    out.push({ date, merchant, amount });
  }
  return { rows: out, skipped, format: layout.format };
}

/** 取込済みかどうかの判定キー。同じ日付・利用先・金額の経費は、同じものとみなす。 */
export function expenseDedupKey(row: ExpenseCsvRow): string {
  return `${row.date}|${row.merchant}|${row.amount}`;
}
