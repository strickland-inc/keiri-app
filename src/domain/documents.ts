/**
 * 帳票ドメイン。請求書・見積書・納品書・発注書・領収書を1つの型で扱う。
 * Sheets/DB いずれのバックエンドでもこの型を読み書きする（永続化方法に非依存）。
 */
import type { TaxRate } from "./money";

export const DOCUMENT_TYPES = [
  "invoice",
  "quote",
  "delivery_note",
  "purchase_order",
  "receipt",
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  invoice: "請求書",
  quote: "見積書",
  delivery_note: "納品書",
  purchase_order: "発注書",
  receipt: "領収書",
};

export const DOCUMENT_STATUSES = [
  "draft",
  "issued",
  "sent",
  "paid",
  "void",
] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export const DOCUMENT_STATUS_LABELS: Record<DocumentStatus, string> = {
  draft: "下書き",
  issued: "発行済",
  sent: "送付済",
  paid: "入金済",
  void: "無効",
};

export interface LineItem {
  name: string;
  quantity: number;
  /** 単位（式・件・ヶ月 など）。任意。 */
  unit?: string;
  /** 税抜単価（円・整数）。 */
  unitPrice: number;
  taxRate: TaxRate;
}

export interface DocumentRecord {
  id: string;
  type: DocumentType;
  /** 採番された番号（0001 など）。下書き段階では空のこともある。 */
  number: string;
  /** 発行日 YYYY-MM-DD。 */
  issueDate: string;
  issuerId: string;
  partyId: string;
  /** 件名。 */
  title: string;
  items: LineItem[];
  /** 備考。 */
  notes: string;
  status: DocumentStatus;

  // ---- 帳票別の任意項目 ----
  /** 請求書：支払期日 YYYY-MM-DD。 */
  dueDate?: string;
  /** 見積書：有効期限 YYYY-MM-DD。 */
  validUntil?: string;
  /** 見積書：支払条件。 */
  paymentTerms?: string;
  /** 領収書：但し書き。 */
  purpose?: string;

  createdAt: string;
  updatedAt: string;
  /** 生成済みPDFのリンク（Drive等）。任意。 */
  pdfUrl?: string;
  /** 帳票テンプレート元のスプレッドシートID。 */
  templateSpreadsheetId?: string;
  /** 生成された帳票シートを保持するスプレッドシートID。 */
  generatedSpreadsheetId?: string;
  /** 生成された帳票シートのgid。 */
  generatedSheetId?: string;
  /** 生成された帳票シート名。 */
  generatedSheetName?: string;
  /** 生成された帳票シートをブラウザで開くURL。 */
  sheetUrl?: string;
}

/** 新規作成時の入力（id・番号・タイムスタンプ・status は採番/サーバ側で付与）。 */
export type NewDocumentInput = Omit<
  DocumentRecord,
  | "id"
  | "number"
  | "createdAt"
  | "updatedAt"
  | "status"
  | "pdfUrl"
  | "templateSpreadsheetId"
  | "generatedSpreadsheetId"
  | "generatedSheetId"
  | "generatedSheetName"
  | "sheetUrl"
> & {
  status?: DocumentStatus;
};

export function isDocumentType(value: string): value is DocumentType {
  return (DOCUMENT_TYPES as readonly string[]).includes(value);
}

function parseIso(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function formatIso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** 日付 `iso` を、`from` → `to` の日数差だけ `base` から進めた日付にする。 */
function shiftLike(
  iso: string | undefined,
  from: string,
  base: string,
): string | undefined {
  if (!iso) return undefined;
  return formatIso(parseIso(base) + (parseIso(iso) - parseIso(from)));
}

/**
 * 既存の書類をコピーして新規作成するときの初期値。
 * 番号・ステータス・生成済みシートは引き継がず、発行日は今日にする。
 * 支払期日・有効期限は「発行日からの日数」を保って今日基準にずらす。
 */
export function buildCopyDraft(
  source: DocumentRecord,
  today: string,
): DocumentRecord {
  return {
    ...source,
    id: "",
    number: "",
    status: "draft",
    issueDate: today,
    dueDate: shiftLike(source.dueDate, source.issueDate, today),
    validUntil: shiftLike(source.validUntil, source.issueDate, today),
    items: source.items.map((item) => ({ ...item })),
    pdfUrl: undefined,
    templateSpreadsheetId: undefined,
    generatedSpreadsheetId: undefined,
    generatedSheetId: undefined,
    generatedSheetName: undefined,
    sheetUrl: undefined,
  };
}
