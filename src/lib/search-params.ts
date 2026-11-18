/** ページの searchParams の値。同じキーが複数あると配列で届く。 */
export type SearchParamValue = string | string[] | undefined;

/** 最初の値を返す。無ければ空文字。 */
export function firstParam(value: SearchParamValue): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}
