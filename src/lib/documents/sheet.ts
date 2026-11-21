/**
 * 帳票のタブの組み立て（純関数）。
 *
 * スプレッドシートにある書式のタブ（`書式_請求書` など）を複製し、どのセルに何を書くかを決める。
 * セルの位置は書式のタブのレイアウトに合わせてあり、書式そのもの（罫線・色・文字の大きさ）は変えない。
 * 実際の複製と書き込みは、スプレッドシート側の窓口が行う（render.ts）。
 */
import {
  DOCUMENT_TYPE_LABELS,
  type DocumentRecord,
} from "../../domain/documents";
import type { Issuer } from "../../domain/issuer";
import type { Party } from "../../domain/party";
import { lineAmount, summarize, type AmountSummary } from "../../domain/money";
import { formatJpDate } from "../utils";
import type { SheetStep } from "../gateway";

export interface DocumentSheetInput {
  doc: DocumentRecord;
  party: Party;
  issuer: Issuer;
}

export interface DocumentSheetPlan {
  /** 複製元の書式のタブ名。 */
  template: string;
  /** 作るタブの名前。 */
  name: string;
  steps: SheetStep[];
}

type Cell = string | number;

/** 書式のタブにあらかじめ用意されている明細の行数（17〜30 行目）。 */
const ITEM_ROWS = 14;
const FIRST_ITEM_ROW = 17;
const COLUMNS = { invoice: 8, receipt: 10 } as const;

const TITLES: Record<DocumentRecord["type"], string> = {
  invoice: "請     求     書",
  quote: "御     見     積     書",
  delivery_note: "納     品     書",
  purchase_order: "発     注     書",
  receipt: "領     収     書",
};

const LEADS: Record<Exclude<DocumentRecord["type"], "receipt">, string> = {
  invoice: "下記の通りご請求申し上げます。",
  quote: "下記の通りお見積申し上げます。",
  delivery_note: "下記の通り納品いたします。",
  purchase_order: "下記の通り発注いたします。",
};

const AMOUNT_LABELS: Record<
  Exclude<DocumentRecord["type"], "receipt">,
  string
> = {
  invoice: "ご請求金額",
  quote: "お見積金額",
  delivery_note: "合計金額",
  purchase_order: "合計金額",
};

export function templateSheetName(type: DocumentRecord["type"]): string {
  return `書式_${DOCUMENT_TYPE_LABELS[type]}`;
}

/** タブ名に使えない文字を除き、長すぎる名前を切る。 */
function safeSheetName(value: string): string {
  return value.replace(/[\[\]\*\/\\?:]/g, "").slice(0, 90);
}

function grid(rows: number, columns: number): Cell[][] {
  return Array.from({ length: rows }, () =>
    Array.from({ length: columns }, (): Cell => ""),
  );
}

function postalCodeLine(postalCode?: string): string {
  return postalCode ? `〒${postalCode}` : "";
}

function yen(value: number): string {
  return `¥${Math.trunc(value).toLocaleString("ja-JP")}`;
}

function honorificLine(party: Party): string {
  if (party.contactName)
    return `${party.contactName}　${party.honorific ?? "様"}`;
  return party.honorific ?? "御中";
}

function issuerAddress(issuer: Issuer): string {
  return [issuer.address, issuer.building].filter(Boolean).join(" ");
}

/**
 * 適格請求書に要る記載。登録番号がある発行元だけに、登録番号と税率ごとの内訳を出す。
 * 書式のタブに専用の欄が無いので、備考の先頭に置く。
 */
function invoiceRegistrationLines(
  issuer: Issuer,
  summary: AmountSummary,
): string[] {
  if (!issuer.registrationNumber) return [];
  return [
    `登録番号：${issuer.registrationNumber}`,
    ...summary.taxLines
      .filter((line) => line.rate > 0)
      .map(
        (line) =>
          `${Math.round(line.rate * 100)}%対象 ${yen(line.taxableAmount)}（消費税 ${yen(line.taxAmount)}）`,
      ),
  ];
}

/** 備考の行の高さ。行の数に合わせて伸ばし、少なくとも 96px にする。 */
function notesHeight(notes: string): number {
  const lines = notes ? notes.split("\n").length : 1;
  return Math.max(96, lines * 21 + 12);
}

/** 請求書・見積書・納品書・発注書。書式のタブのレイアウトが共通。 */
function ledgerSteps({ doc, party, issuer }: DocumentSheetInput): SheetStep[] {
  const type = doc.type as Exclude<DocumentRecord["type"], "receipt">;
  const summary = summarize(doc.items);
  // 明細が用意された行数を超えるときは、明細の末尾に行を足し、それより下の行をその分ずらす。
  const extra = Math.max(0, doc.items.length - ITEM_ROWS);
  const lastItemRow = FIRST_ITEM_ROW + ITEM_ROWS - 1;
  const below = (row: number): number => row + extra;
  const rows = grid(40 + extra, COLUMNS.invoice);
  const put = (row: number, column: number, value: Cell): void => {
    rows[row - 1][column] = value;
  };
  const [A, B, F, G, H] = [0, 1, 5, 6, 7];

  put(1, A, TITLES[type]);
  put(4, A, postalCodeLine(party.postalCode));
  put(5, A, party.address ?? "");
  put(7, A, party.name);
  put(8, A, honorificLine(party));
  put(11, A, LEADS[type]);
  put(13, A, AMOUNT_LABELS[type]);
  put(13, B, summary.total);

  put(4, G, "発行日：");
  put(4, H, formatJpDate(doc.issueDate));
  put(5, G, "伝票番号：");
  put(5, H, doc.number);
  put(7, F, issuer.name);
  // 記載名義は会社名の直下に置き、住所以下を 1 行下げる。12 行目は枠のない空き行なので、13 行目には届かない。
  const shift = issuer.signatoryName ? 1 : 0;
  if (issuer.signatoryName) put(8, F, issuer.signatoryName);
  put(8 + shift, F, postalCodeLine(issuer.postalCode));
  put(9 + shift, F, issuerAddress(issuer));
  if (issuer.phone) {
    put(10 + shift, F, "電  話：");
    put(10 + shift, G, issuer.phone);
  }
  if (issuer.email) {
    put(11 + shift, F, "E-mail：");
    put(11 + shift, G, issuer.email);
  }

  if (type === "invoice") {
    put(13, F, "振込先");
    put(13, G, issuer.bankInfo ?? "");
  } else if (type === "quote" && doc.paymentTerms) {
    put(13, F, "支払条件");
    put(13, G, doc.paymentTerms);
  }
  if (type === "quote" && doc.validUntil) {
    put(14, F, "有効期限");
    put(14, G, formatJpDate(doc.validUntil));
  } else if (doc.dueDate) {
    put(14, F, "支払期日");
    put(14, G, formatJpDate(doc.dueDate));
  }

  put(16, A, "商品名");
  put(16, F, "数量");
  put(16, G, "単価");
  put(16, H, "金額");
  doc.items.forEach((item, index) => {
    const row = FIRST_ITEM_ROW + index;
    put(row, A, item.name);
    // 数は数値で渡し、書式のタブの表示形式（3 桁区切り）と右寄せを効かせる。単位があるときだけ文字にする。
    put(row, F, item.unit ? `${item.quantity}${item.unit}` : item.quantity);
    put(row, G, item.unitPrice);
    put(row, H, lineAmount(item));
  });

  put(below(32), F, "小計");
  put(below(32), G, summary.subtotal);
  put(below(33), F, "消費税");
  put(below(33), G, summary.taxTotal);
  put(below(34), F, "合計金額");
  put(below(34), G, summary.total);
  put(below(36), A, "備考");
  const notesRow = below(37);
  const notes = [...invoiceRegistrationLines(issuer, summary), doc.notes]
    .filter(Boolean)
    .join("\n");
  put(notesRow, A, notes);

  const notesRange = `A${notesRow}:H${notesRow}`;
  const addedRows: SheetStep[] = Array.from({ length: extra }, (_, index) => ({
    do: "merge",
    range: `A${lastItemRow + 1 + index}:E${lastItemRow + 1 + index}`,
  }));

  return [
    // 備考欄にかかる結合は、値を書く前に解く。結合の中の左上以外に書いた値は、あとで解いても残らない。
    { do: "unmerge", range: "A36:H40" },
    ...(extra > 0
      ? [
          {
            do: "insertRowsAfter",
            row: lastItemRow,
            count: extra,
          } satisfies SheetStep,
          ...addedRows,
        ]
      : []),
    { do: "values", range: `A1:H${rows.length}`, values: rows },
    { do: "merge", range: notesRange },
    { do: "showRows", from: below(36), count: 2 },
    { do: "hideRows", from: below(38), count: 3 },
    { do: "rowHeight", row: notesRow, px: notesHeight(notes) },
    { do: "format", range: notesRange, wrap: true, vertical: "middle" },
    { do: "borderBottom", range: notesRange },
    { do: "format", range: "H5", horizontal: "right" },
    { do: "format", range: "F13", horizontal: "center" },
    { do: "format", range: "G13:H13", horizontal: "left" },
  ];
}

/** 領収書。ほかの書類とはレイアウトが違う。 */
function receiptSteps({ doc, party, issuer }: DocumentSheetInput): SheetStep[] {
  const summary = summarize(doc.items);
  const rows = grid(14, COLUMNS.receipt);
  const put = (row: number, column: number, value: Cell): void => {
    rows[row - 1][column] = value;
  };
  const [A, B, C, D, F, H, I] = [0, 1, 2, 3, 5, 7, 8];
  const purpose = doc.purpose || doc.title;

  put(1, A, TITLES.receipt);
  put(3, H, "No.");
  put(3, I, doc.number);
  put(4, A, `${party.name}　${honorificLine(party)}`);
  put(4, H, "発行日");
  put(4, I, formatJpDate(doc.issueDate));
  put(6, C, "金額");
  put(6, D, summary.total);
  put(7, C, "但し");
  put(7, D, purpose ? `${purpose}として` : "");
  put(8, C, "上記正に領収いたしました");
  put(10, F, issuer.name);
  put(11, A, "　内訳");
  put(
    11,
    F,
    [postalCodeLine(issuer.postalCode), issuerAddress(issuer)]
      .filter(Boolean)
      .join("　"),
  );
  put(12, A, "税抜金額");
  put(12, B, summary.subtotal);
  if (issuer.phone) put(12, F, `電  話：　${issuer.phone}`);
  put(13, A, "消費税等");
  put(13, B, summary.taxTotal);
  if (issuer.email) put(13, F, `E-mail：  ${issuer.email}`);
  if (issuer.registrationNumber)
    put(14, F, `登録番号：${issuer.registrationNumber}`);

  return [{ do: "values", range: `A1:J${rows.length}`, values: rows }];
}

export function planDocumentSheet(
  input: DocumentSheetInput,
): DocumentSheetPlan {
  const { doc, party } = input;
  return {
    template: templateSheetName(doc.type),
    name: safeSheetName(
      `${DOCUMENT_TYPE_LABELS[doc.type]}_${doc.number}_${party.name}`,
    ),
    steps: doc.type === "receipt" ? receiptSteps(input) : ledgerSteps(input),
  };
}
