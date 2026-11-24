/**
 * 監査ログの summary を作る部品。"use server" ではないので、同期関数をそのまま書ける。
 * 秘密や明細の全文、住所などは入れない。書類は種類・番号・取引先名・税込金額だけを書く。
 */
import { DOCUMENT_TYPE_LABELS, type DocumentRecord } from "@/domain/documents";
import { summarize } from "@/domain/money";

export function yen(n: number): string {
  return `${n.toLocaleString("ja-JP")} 円`;
}

/** 「請求書 0012」。番号が空（下書き）のときは種類だけ。 */
export function documentLabel(doc: DocumentRecord): string {
  const type = DOCUMENT_TYPE_LABELS[doc.type] ?? doc.type;
  return doc.number ? `${type} ${doc.number}` : type;
}

/** 「請求書 0012（取引先: 〇〇、金額 110,000 円）」 */
export function describeDocument(
  doc: DocumentRecord,
  partyName?: string,
): string {
  const total = summarize(doc.items).total;
  const party = partyName ? `取引先: ${partyName}、` : "";
  return `${documentLabel(doc)}（${party}金額 ${yen(total)}）`;
}
