/**
 * エージェント用「書類作成 API」の入力を検証し、書類の作成入力に変換する（純関数）。
 * 取引先は id か名前（完全一致）で指定する。発行元を省くと既定の発行元になる。
 */
import type { NewDocumentInput, DocumentRecord } from "../../domain/documents";
import type { Party } from "../../domain/party";
import type { Issuer } from "../../domain/issuer";

const DOCUMENT_TYPES = [
  "invoice",
  "quote",
  "delivery_note",
  "purchase_order",
  "receipt",
];
const TAX_RATES = [0, 0.08, 0.1];
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** 1 回の要求で作れる書類数の上限（外部通信を 50 回以内に収めるため）。 */
export const MAX_DOCUMENTS_PER_REQUEST = 5;

export type AgentDocumentResult =
  | { index: number; ok: true; input: NewDocumentInput; duplicateOf?: string }
  | { index: number; ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalDate(
  value: unknown,
  label: string,
): string | undefined | Error {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) {
    return new Error(`${label}は YYYY-MM-DD で指定してください`);
  }
  return value;
}

function parseItems(value: unknown): NewDocumentInput["items"] | Error {
  if (!Array.isArray(value) || value.length === 0)
    return new Error("明細（items）が必要です");
  const items: NewDocumentInput["items"] = [];
  for (const [i, raw] of value.entries()) {
    if (!isRecord(raw)) return new Error(`明細 ${i + 1} の形式が不正です`);
    const name = typeof raw.name === "string" ? raw.name.trim() : "";
    const quantity = Number(raw.quantity ?? 1);
    const unitPrice = Number(raw.unitPrice);
    const taxRate = Number(raw.taxRate ?? 0.1);
    if (!name) return new Error(`明細 ${i + 1} の品名（name）が必要です`);
    if (!Number.isFinite(quantity) || quantity <= 0)
      return new Error(`明細 ${i + 1} の数量が不正です`);
    if (!Number.isInteger(unitPrice))
      return new Error(
        `明細 ${i + 1} の税抜単価（unitPrice）は整数の円で指定してください`,
      );
    if (!TAX_RATES.includes(taxRate))
      return new Error(`明細 ${i + 1} の税率は 0 / 0.08 / 0.1 のいずれかです`);
    items.push({
      name,
      quantity,
      unit: typeof raw.unit === "string" && raw.unit ? raw.unit : undefined,
      unitPrice,
      taxRate: taxRate as 0 | 0.08 | 0.1,
    });
  }
  return items;
}

function resolveParty(
  raw: Record<string, unknown>,
  parties: Party[],
): Party | Error {
  if (typeof raw.partyId === "string" && raw.partyId) {
    return (
      parties.find((p) => p.id === raw.partyId) ??
      new Error("partyId の取引先が見つかりません")
    );
  }
  if (typeof raw.partyName === "string" && raw.partyName) {
    const matches = parties.filter((p) => p.name === raw.partyName);
    if (matches.length === 1) return matches[0];
    return new Error(
      matches.length === 0
        ? `取引先「${raw.partyName}」が見つかりません（名前は完全一致）`
        : `取引先「${raw.partyName}」が複数あります。partyId で指定してください`,
    );
  }
  return new Error("取引先（partyId か partyName）が必要です");
}

function resolveIssuer(
  raw: Record<string, unknown>,
  issuers: Issuer[],
): Issuer | Error {
  if (typeof raw.issuerId === "string" && raw.issuerId) {
    return (
      issuers.find((i) => i.id === raw.issuerId) ??
      new Error("issuerId の発行元が見つかりません")
    );
  }
  const fallback = issuers.find((i) => i.isDefault) ?? issuers[0];
  return fallback ?? new Error("発行元が登録されていません");
}

/**
 * 同じ会社（発行元）・種類・取引先・発行日・件名の書類が既にあれば、それを返す（二重作成の防止）。
 * 会社ごとに帳簿と採番を分けているため、別の会社の書類は重複として扱わない。
 */
function findDuplicate(
  input: NewDocumentInput,
  existing: DocumentRecord[],
): DocumentRecord | undefined {
  return existing.find(
    (d) =>
      d.issuerId === input.issuerId &&
      d.type === input.type &&
      d.partyId === input.partyId &&
      d.issueDate === input.issueDate &&
      d.title === input.title &&
      d.status !== "void",
  );
}

export function parseAgentDocumentRequest(
  body: unknown,
  context: { parties: Party[]; issuers: Issuer[]; existing: DocumentRecord[] },
): AgentDocumentResult[] | Error {
  if (
    !isRecord(body) ||
    !Array.isArray(body.documents) ||
    body.documents.length === 0
  ) {
    return new Error("documents（配列）が必要です");
  }
  if (body.documents.length > MAX_DOCUMENTS_PER_REQUEST) {
    return new Error(
      `1 回に作れる書類は ${MAX_DOCUMENTS_PER_REQUEST} 件までです`,
    );
  }

  return body.documents.map((raw: unknown, index): AgentDocumentResult => {
    const fail = (error: string): AgentDocumentResult => ({
      index,
      ok: false,
      error,
    });
    if (!isRecord(raw)) return fail("書類の形式が不正です");

    const type = typeof raw.type === "string" ? raw.type : "invoice";
    if (!DOCUMENT_TYPES.includes(type)) return fail("type が不正です");
    const title = typeof raw.title === "string" ? raw.title.trim() : "";
    if (!title) return fail("件名（title）が必要です");

    const issueDate = optionalDate(raw.issueDate, "発行日");
    if (issueDate instanceof Error) return fail(issueDate.message);
    if (!issueDate) return fail("発行日（issueDate）が必要です");
    const dueDate = optionalDate(raw.dueDate, "支払期日");
    if (dueDate instanceof Error) return fail(dueDate.message);
    const validUntil = optionalDate(raw.validUntil, "有効期限");
    if (validUntil instanceof Error) return fail(validUntil.message);

    const party = resolveParty(raw, context.parties);
    if (party instanceof Error) return fail(party.message);
    const issuer = resolveIssuer(raw, context.issuers);
    if (issuer instanceof Error) return fail(issuer.message);
    const items = parseItems(raw.items);
    if (items instanceof Error) return fail(items.message);

    const input: NewDocumentInput = {
      type: type as NewDocumentInput["type"],
      issuerId: issuer.id,
      partyId: party.id,
      title,
      issueDate,
      items,
      notes: typeof raw.notes === "string" ? raw.notes : "",
      dueDate,
      validUntil,
      paymentTerms:
        typeof raw.paymentTerms === "string" ? raw.paymentTerms : undefined,
      purpose: typeof raw.purpose === "string" ? raw.purpose : undefined,
    };
    const duplicate = findDuplicate(input, context.existing);
    return { index, ok: true, input, duplicateOf: duplicate?.id };
  });
}
