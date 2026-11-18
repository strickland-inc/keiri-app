/**
 * 銀行明細の自動仕訳（サーバ専用）。1 行ずつ次の順で勘定科目を決める。
 *   1. 入金: 未入金の請求書と金額が一致すれば照合（複数・手数料差引は Jev が請求書を選ぶ）
 *   2. 過去に確認済みの同じ摘要があれば、その科目を再利用
 *   3. それ以外は Jev が科目を選ぶ（確信度が低ければ「要確認」にする）
 * Jev に繋がらない場合も取り込みは止めず、仮受金・仮払金に入れて「要確認」にする。
 */
import {
  BANK_DEPOSIT_ACCOUNTS,
  BANK_WITHDRAWAL_ACCOUNTS,
  COLUMN_ROLES,
  DEPOSIT_SUSPENSE,
  RECEIVABLE,
  WITHDRAWAL_SUSPENSE,
  descriptionKey,
  extractRows,
  findInvoiceCandidates,
  isUnpaidInvoice,
  type BankTransaction,
  type ColumnMapping,
  type ColumnRole,
  type InvoiceCandidate,
  type NewBankTransactionInput,
  type ParsedBankRow,
} from "../domain/bank.ts";
import type { DocumentRecord } from "../domain/documents.ts";
import { formatYen } from "../domain/money.ts";
import { askJevChoices, type JevChoice } from "./jev.ts";

type AskJev = typeof askJevChoices;

/** この確信度未満の判断は「要確認」にする。 */
export const REVIEW_THRESHOLD = 0.8;
/** 請求書の照合を Jev の判断で確定する最低確信度。 */
const MATCH_THRESHOLD = 0.7;
const CONCURRENCY = 5;
const NONE = "none";

export interface ClassifyContext {
  /** 取り込み済みの明細（重複・過去の判断の再利用・照合済み請求書の除外に使う）。 */
  existing: readonly BankTransaction[];
  /** 請求書（照合の対象を絞るのはこの関数）。 */
  invoices: readonly DocumentRecord[];
  partyNames: ReadonlyMap<string, string>;
}

export interface ClassifyResult {
  created: NewBankTransactionInput[];
  duplicates: number;
  /** 入金済みにすべき請求書。 */
  matchedDocumentIds: string[];
}

async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return results;
}

function invoiceLabel(
  c: InvoiceCandidate,
  partyNames: ReadonlyMap<string, string>,
): string {
  const party = partyNames.get(c.doc.partyId) ?? "取引先不明";
  return `${c.doc.number} ${party} 「${c.doc.title}」 ${formatYen(c.total)}（発行日 ${c.doc.issueDate}）`;
}

function stateOf(row: ParsedBankRow) {
  return {
    取引日: row.date,
    摘要: row.description || "（摘要なし）",
    区分: row.amount > 0 ? "入金" : "出金",
    金額: Math.abs(row.amount),
  };
}

const CATEGORY_INSTRUCTIONS = (inflow: boolean) =>
  `この銀行口座の${inflow ? "入金" : "出金"}は、会計上どの勘定科目になるか。` +
  "法人（合同会社）の経理として判断する。摘要は銀行が半角カナで出すため、カタカナの読みで書かれていることが多い。";

interface Decision {
  account: string;
  confidence: number;
  method: BankTransaction["method"];
  matchedDocumentId?: string;
}

function fallbackAccount(inflow: boolean): string {
  return inflow ? DEPOSIT_SUSPENSE : WITHDRAWAL_SUSPENSE;
}

async function categorize(row: ParsedBankRow, ask: AskJev): Promise<Decision> {
  const inflow = row.amount > 0;
  const criteria = inflow ? BANK_DEPOSIT_ACCOUNTS : BANK_WITHDRAWAL_ACCOUNTS;
  try {
    const answers = await ask(stateOf(row), {
      account: { instructions: CATEGORY_INSTRUCTIONS(inflow), criteria },
    });
    const answer = answers.account as JevChoice | undefined;
    if (!answer || !(answer.choice in criteria))
      throw new Error("想定外の回答");
    // 照合できなかった「売掛金」は残高がマイナスになるため仮受金に入れる
    if (inflow && answer.choice === RECEIVABLE) {
      return {
        account: DEPOSIT_SUSPENSE,
        confidence: Math.min(answer.confidence, 0.5),
        method: "jev",
      };
    }
    return {
      account: answer.choice,
      confidence: answer.confidence,
      method: "jev",
    };
  } catch {
    return {
      account: fallbackAccount(inflow),
      confidence: 0,
      method: "fallback",
    };
  }
}

/** 候補の中から入金に対応する請求書を Jev に選ばせる。選べなければ null。 */
async function pickInvoice(
  row: ParsedBankRow,
  candidates: readonly InvoiceCandidate[],
  partyNames: ReadonlyMap<string, string>,
  ask: AskJev,
): Promise<{ doc: DocumentRecord; confidence: number } | null> {
  const criteria: Record<string, string> = Object.fromEntries(
    candidates.map((c) => [c.doc.id, invoiceLabel(c, partyNames)]),
  );
  criteria[NONE] = "どの請求書の入金でもない";
  try {
    const answers = await ask(stateOf(row), {
      invoice: {
        instructions:
          "この入金は、どの請求書の支払いか。摘要の振込人名（半角カナ）と請求書の取引先名の読みが近いものを選ぶ。振込手数料が差し引かれて入金額が少ないことがある。",
        criteria,
      },
    });
    const answer = answers.invoice;
    if (
      !answer ||
      answer.choice === NONE ||
      answer.confidence < MATCH_THRESHOLD
    )
      return null;
    const doc = candidates.find((c) => c.doc.id === answer.choice)?.doc;
    return doc ? { doc, confidence: answer.confidence } : null;
  } catch {
    return null;
  }
}

export async function classifyRows(
  rows: readonly ParsedBankRow[],
  ctx: ClassifyContext,
  ask: AskJev = askJevChoices,
): Promise<ClassifyResult> {
  const knownKeys = new Set(ctx.existing.map((t) => t.key));
  const fresh = rows.filter((r) => !knownKeys.has(r.key));
  const duplicates = rows.length - fresh.length;

  // 過去に確認済みの摘要 → 科目（入金・出金を分けて覚える）
  const learned = new Map<string, string>();
  for (const t of ctx.existing) {
    const key = descriptionKey(t.description);
    if (
      !key ||
      t.needsReview ||
      t.method === "fallback" ||
      t.account === RECEIVABLE
    )
      continue;
    learned.set(`${t.amount > 0 ? "+" : "-"}${key}`, t.account);
  }

  const used = new Set(
    ctx.existing.flatMap((t) =>
      t.matchedDocumentId ? [t.matchedDocumentId] : [],
    ),
  );
  const open = ctx.invoices.filter(
    (d) => isUnpaidInvoice(d) && !used.has(d.id),
  );

  const decisions = new Map<string, Decision>();
  const needsInvoicePick: {
    row: ParsedBankRow;
    candidates: InvoiceCandidate[];
  }[] = [];
  const needsCategory: ParsedBankRow[] = [];

  // 1) 金額が一致する請求書が 1 件だけなら、その場で照合（古い順に消し込む）
  for (const row of fresh) {
    if (row.amount > 0) {
      const available = open.filter((d) => !used.has(d.id));
      const { exact, nearWithFee } = findInvoiceCandidates(
        row.amount,
        available,
      );
      if (exact.length === 1) {
        used.add(exact[0].doc.id);
        decisions.set(row.key, {
          account: RECEIVABLE,
          confidence: 0.95,
          method: "match",
          matchedDocumentId: exact[0].doc.id,
        });
        continue;
      }
      const candidates = exact.length > 1 ? exact : nearWithFee;
      if (candidates.length > 0) {
        needsInvoicePick.push({ row, candidates });
        continue;
      }
    }
    needsCategory.push(row);
  }

  // 2) 複数候補・手数料差引は Jev が請求書を選ぶ。選べなければ科目の判断へ。
  //    同じ請求書を 2 回選ばないよう、1 件ずつ順に聞いて使用済みを候補から外す
  for (const p of needsInvoicePick) {
    const candidates = p.candidates.filter((c) => !used.has(c.doc.id));
    const pick =
      candidates.length === 0
        ? null
        : await pickInvoice(p.row, candidates, ctx.partyNames, ask);
    if (pick) {
      used.add(pick.doc.id);
      decisions.set(p.row.key, {
        account: RECEIVABLE,
        confidence: pick.confidence,
        method: "match",
        matchedDocumentId: pick.doc.id,
      });
    } else {
      needsCategory.push(p.row);
    }
  }

  // 3) 過去の判断の再利用 → 残りは Jev
  const toAsk: ParsedBankRow[] = [];
  for (const row of needsCategory) {
    const reused = learned.get(
      `${row.amount > 0 ? "+" : "-"}${descriptionKey(row.description)}`,
    );
    if (reused && descriptionKey(row.description)) {
      decisions.set(row.key, {
        account: reused,
        confidence: 1,
        method: "rule",
      });
    } else {
      toAsk.push(row);
    }
  }
  const asked = await mapLimit(toAsk, CONCURRENCY, (row) =>
    categorize(row, ask),
  );
  toAsk.forEach((row, i) => decisions.set(row.key, asked[i]));

  const created = fresh.map((row): NewBankTransactionInput => {
    const d = decisions.get(row.key) as Decision;
    return {
      key: row.key,
      date: row.date,
      seq: row.seq,
      description: row.description,
      amount: row.amount,
      balance: row.balance,
      account: d.account,
      confidence: d.confidence,
      method: d.method,
      needsReview: d.confidence < REVIEW_THRESHOLD,
      matchedDocumentId: d.matchedDocumentId,
    };
  });
  return {
    created,
    duplicates,
    matchedDocumentIds: created.flatMap((t) =>
      t.matchedDocumentId ? [t.matchedDocumentId] : [],
    ),
  };
}

// ── 列の判定（見出しの語句で決められない CSV を Jev に聞く）──────────────────────

const ROLE_DESCRIPTIONS: Record<ColumnRole, string> = {
  date: "取引の日付",
  description: "摘要・取引内容・振込人名・備考など、取引の説明文",
  deposit: "入金額・お預入れ金額（入金のときだけ値がある列）",
  withdrawal: "出金額・お引出し金額（出金のときだけ値がある列）",
  amount: "入出金どちらも入る金額の列（入金は正、出金は負など）",
  direction: "入金か出金かを示す区分の列",
  balance: "取引後の残高",
  other: "上のどれでもない（通番・店番・メモ欄など）",
};

/** 見出し行らしき行の番号。最初の日付を含む行の 1 つ前が文字だけなら、それを見出しとする。 */
function guessHeaderRow(rows: readonly string[][]): number {
  const firstData = rows.findIndex((r) =>
    r.some((c) =>
      /^\s*(\d{4}[/\-.年]\d{1,2}[/\-.月]\d{1,2}|\d{8}|(令和|平成|[RH])\s*\d)/.test(
        c.normalize("NFKC"),
      ),
    ),
  );
  return firstData > 0 ? firstData - 1 : -1;
}

export async function detectColumnsWithJev(
  rows: readonly string[][],
  ask: AskJev = askJevChoices,
): Promise<ColumnMapping | null> {
  const headerRow = guessHeaderRow(rows);
  const body = rows.slice(headerRow + 1, headerRow + 1 + 6);
  const width = Math.max(0, ...rows.slice(0, 30).map((r) => r.length));
  if (body.length === 0 || width === 0) return null;

  const state = {
    見出し行: headerRow >= 0 ? rows[headerRow] : null,
    データ例: body,
  };
  const questions = Object.fromEntries(
    Array.from({ length: width }, (_, i) => [
      `列${i}`,
      {
        instructions: `銀行の取引明細 CSV の ${i + 1} 列目（左から数える）は、どの役割の列か。`,
        criteria: ROLE_DESCRIPTIONS,
      },
    ]),
  );
  try {
    const answers = await ask(state, questions);
    const roles = Array.from({ length: width }, (_, i): ColumnRole => {
      const choice = answers[`列${i}`]?.choice;
      return COLUMN_ROLES.find((r) => r === choice) ?? "other";
    });
    const has = (r: ColumnRole) => roles.includes(r);
    if (!has("date") || !(has("amount") || has("deposit") || has("withdrawal")))
      return null;
    return { headerRow, roles };
  } catch {
    return null;
  }
}

/** CSV の行から取引を取り出す。列の判定は、見出しで決まらなければ Jev に任せる。 */
export async function readBankCsv(
  rows: readonly string[][],
  detected: ColumnMapping | null,
  ask: AskJev = askJevChoices,
) {
  const mapping = detected ?? (await detectColumnsWithJev(rows, ask));
  if (!mapping) return null;
  return { mapping, ...extractRows(rows, mapping) };
}
