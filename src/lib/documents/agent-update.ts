/**
 * エージェント用 API の「発行元の更新」と「書類の無効化」の検証（純関数）。
 * 更新できる項目と、無効にできる状態を、ここで固定する。
 */
import type { Issuer } from "../../domain/issuer";
import type { DocumentStatus } from "../../domain/documents";

/** エージェントが書き換えてよい発行元の項目（名称・既定・印影は対象外）。 */
export const ISSUER_PATCH_FIELDS = [
  "postalCode",
  "address",
  "building",
  "phone",
  "email",
  "registrationNumber",
  "bankInfo",
] as const;

export type IssuerPatch = Partial<
  Pick<Issuer, (typeof ISSUER_PATCH_FIELDS)[number]>
>;

const MAX_LENGTH = 500;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 本文を検証して更新内容にする。空文字はその項目を空にする。未知の項目は拒否する。 */
export function parseIssuerPatch(body: unknown): IssuerPatch | Error {
  if (!isRecord(body)) return new Error("JSON のオブジェクトが必要です");
  const keys = Object.keys(body);
  if (keys.length === 0) return new Error("更新する項目が必要です");

  const allowed = new Set<string>(ISSUER_PATCH_FIELDS);
  const unknown = keys.filter((k) => !allowed.has(k));
  if (unknown.length > 0) {
    return new Error(
      `更新できない項目です: ${unknown.join(", ")}（更新できるのは ${ISSUER_PATCH_FIELDS.join(", ")}）`,
    );
  }

  const patch: IssuerPatch = {};
  for (const key of ISSUER_PATCH_FIELDS) {
    if (!(key in body)) continue;
    const value = body[key];
    if (typeof value !== "string")
      return new Error(`${key} は文字列で指定してください`);
    // 振込先は複数行。Sheets 上の改行は CRLF のこともあるので LF にそろえる。
    const normalized = value.replace(/\r\n?/g, "\n").trim();
    if (normalized.length > MAX_LENGTH)
      return new Error(`${key} は ${MAX_LENGTH} 文字以内にしてください`);
    patch[key] = normalized;
  }
  return patch;
}

/** 画面の「無効にする」と同じ規則に、下書きを加えたもの（入金済み・無効済みは不可）。 */
const VOIDABLE: readonly DocumentStatus[] = ["draft", "issued", "sent"];

export function canVoid(status: DocumentStatus): boolean {
  return VOIDABLE.includes(status);
}
