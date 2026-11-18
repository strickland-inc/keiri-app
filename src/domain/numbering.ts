import type { DocumentType } from "./documents";

/**
 * 採番フォーマット。「0001」のように連番だけをゼロ埋めする。
 * 帳票種別は DocumentRecord.type で管理するため、表示番号には含めない。
 */
export function formatNumber(
  _type: DocumentType,
  seq: number,
  pad = 4,
): string {
  return String(seq).padStart(pad, "0");
}

/** 採番済み番号から連番部分を読む（例：0007 → 7）。失敗時は null。 */
export function parseSeq(numberText: string): number | null {
  const m = numberText.match(/(\d+)\s*$/);
  return m ? Number.parseInt(m[1], 10) : null;
}
