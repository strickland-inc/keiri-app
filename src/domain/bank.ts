/**
 * 銀行明細（CSV）ドメイン。銀行ごとに形式が違う CSV を、銀行名の指定なしで読み取るための純関数群。
 *
 * - `decodeText` / `parseCsv`: 文字コード・区切り文字・引用符の差を吸収する
 * - `detectColumns` / `extractRows`: 見出しの語句と値の形から 日付・摘要・入金・出金・残高 の列を見つける
 * - `findInvoiceCandidates`: 入金を未入金の請求書へ照合する候補を挙げる
 * 勘定科目の判断（Jev）はサーバ側（lib/bank-classifier.ts）で行う。
 */
import type { DocumentRecord } from "./documents.ts";
import { EXPENSE_CATEGORIES, type ExpenseCategory } from "./expense.ts";
import { summarize } from "./money.ts";

// ── 型 ────────────────────────────────────────────────────────────────────────

export type ClassifyMethod = "match" | "rule" | "jev" | "manual" | "fallback";

export interface BankTransaction {
  id: string;
  /** 重複取り込み防止用のキー（日付・金額・摘要・残高・同一行の通し番号）。 */
  key: string;
  /** YYYY-MM-DD */
  date: string;
  /** 同じ日付内での並び順（古い順）。 */
  seq: number;
  /** 正規化済みの摘要（全角化・空白整理済み）。 */
  description: string;
  /** 入金は正、出金は負（円・整数）。 */
  amount: number;
  /** 取引後の残高。CSV に無ければ undefined。 */
  balance?: number;
  /** 相手勘定科目（現金預金の反対側）。 */
  account: string;
  /** 判断の信頼度 0〜1。 */
  confidence: number;
  method: ClassifyMethod;
  needsReview: boolean;
  /** 照合した請求書。 */
  matchedDocumentId?: string;
  createdAt: string;
  updatedAt: string;
}

export type NewBankTransactionInput = Omit<
  BankTransaction,
  "id" | "createdAt" | "updatedAt"
>;

/** CSV から読み取った 1 行（科目判断の前）。 */
export interface ParsedBankRow {
  key: string;
  date: string;
  seq: number;
  description: string;
  amount: number;
  balance?: number;
}

// ── 勘定科目の候補 ─────────────────────────────────────────────────────────────

export const BANK_DEPOSIT_ACCOUNTS: Readonly<Record<string, string>> = {
  売掛金: "取引先からの売上代金の入金（請求書の支払）",
  役員借入金: "代表者・役員・個人からの入金、出資の入金",
  借入金: "金融機関などからの融資の入金",
  受取利息: "預金の利息（例: リソク）",
  雑収入: "還付金・補助金・保険金・ポイント還元など、売上以外の入金",
  仮受金: "内容が判断できない入金",
};

const EXPENSE_HINTS: Record<Exclude<ExpenseCategory, "要確認">, string> = {
  旅費交通費: "電車・タクシー・出張・宿泊・駐車場（例: JR、スイカ、パスモ）",
  通信費:
    "携帯・インターネット・電話・郵便・サーバー・ドメイン（例: ツウシンヒ、ドコモ、ソフトバンク、NTT）",
  消耗品費: "文房具・備品・少額の物品",
  会議費: "会議・打合せの飲食",
  接待交際費: "取引先との飲食・贈答",
  広告宣伝費: "広告・販促（例: グーグル、メタ、コウコク）",
  新聞図書費: "書籍・新聞・有料の情報サービス",
  研修費: "セミナー・研修・講座の受講料",
  支払手数料:
    "振込手数料・決済手数料・サービス利用手数料（例: フリコミテスウリョウ、テスウリョウ）",
  外注費: "業務委託・外注先・フリーランスへの支払",
  荷造運賃: "宅配便・配送・梱包（例: ヤマト、サガワ）",
  水道光熱費: "電気・ガス・水道（例: デンリョク、ガス、スイドウ）",
  地代家賃:
    "事務所・駐車場などの家賃・賃料（例: ヤチン、チンリョウ、ツキガク）",
  修繕費: "修理・メンテナンス",
  保険料: "各種保険料（例: ホケン）",
  租税公課: "税金・印紙・公租公課（例: ゼイ、ノウゼイ、コクゼイ）",
  福利厚生費: "従業員のための支出",
  車両費: "ガソリン・車検・自動車関連",
  諸会費: "会費・団体の年会費",
  雑費: "上のどれにも当てはまらない少額の事業経費",
};

export const BANK_WITHDRAWAL_ACCOUNTS: Readonly<Record<string, string>> = {
  ...EXPENSE_HINTS,
  未払金:
    "クレジットカードの引落（カード会社への支払。例: カード、ヒキオトシ、ラクテンカード、ミツイスミトモカード）。経費は別途計上済み",
  借入金: "借入金の元本の返済（例: ヘンサイ）",
  支払利息: "借入金の利息（例: リソク）",
  役員貸付金: "代表者・役員個人の氏名宛ての支払や、私的な支出",
  役員借入金: "役員からの借入金の返済",
  仮払金: "内容が判断できない出金（例: ATM出金）",
};

export const DEPOSIT_SUSPENSE = "仮受金";
export const WITHDRAWAL_SUSPENSE = "仮払金";
export const RECEIVABLE = "売掛金";

/** 入金・出金それぞれで選べる勘定科目名。 */
export function accountsFor(amount: number): string[] {
  return Object.keys(
    amount >= 0 ? BANK_DEPOSIT_ACCOUNTS : BANK_WITHDRAWAL_ACCOUNTS,
  );
}

export function isExpenseAccount(name: string): name is ExpenseCategory {
  return (EXPENSE_CATEGORIES as readonly string[]).includes(name);
}

// ── 文字コード・CSV ───────────────────────────────────────────────────────────

/** UTF-8 として読め（BOM 含む）なければ Shift_JIS（銀行 CSV の多くはこちら）として読む。 */
export function decodeText(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  try {
    return new TextDecoder("utf-8", { fatal: true })
      .decode(view)
      .replace(/^﻿/, "");
  } catch {
    return new TextDecoder("shift_jis").decode(view);
  }
}

function detectDelimiter(text: string): string {
  const sample = text.split(/\r?\n/).slice(0, 20).join("\n");
  const counts = [",", "\t", ";"].map(
    (d) => [d, sample.split(d).length - 1] as const,
  );
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ",";
}

/** 引用符・改行入りセルに対応した CSV パーサ。空行は捨てる。 */
export function parseCsv(text: string): string[][] {
  const delimiter = detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  const endCell = () => {
    row.push(cell);
    cell = "";
  };
  const endRow = () => {
    endCell();
    if (row.some((c) => c.trim() !== "")) rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === delimiter) {
      endCell();
    } else if (ch === "\n") {
      endRow();
    } else if (ch !== "\r") {
      cell += ch;
    }
  }
  if (cell !== "" || row.length > 0) endRow();
  return rows;
}

// ── 値の読み取り ──────────────────────────────────────────────────────────────

/** 全角英数・半角カナを標準形（NFKC）にし、空白を 1 つにまとめる。 */
export function normalizeText(s: string): string {
  return s.normalize("NFKC").replace(/\s+/g, " ").trim();
}

/** 日付（西暦・和暦・区切り違い・8 桁）を YYYY-MM-DD にする。読めなければ null。 */
export function parseDate(raw: string): string | null {
  const s = raw.normalize("NFKC").trim();
  let y: number;
  let m: number;
  let d: number;

  let match = s.match(/^(\d{4})[/\-.年](\d{1,2})[/\-.月](\d{1,2})日?/);
  if (match) {
    [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else if ((match = s.match(/^(\d{4})(\d{2})(\d{2})$/))) {
    [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else if (
    (match = s.match(
      /^(令和|平成|R|H)\s*(\d{1,2}|元)[/\-.年](\d{1,2})[/\-.月](\d{1,2})日?/i,
    ))
  ) {
    const base = /令和|R/i.test(match[1]) ? 2018 : 1988;
    y = base + (match[2] === "元" ? 1 : Number(match[2]));
    [m, d] = [Number(match[3]), Number(match[4])];
  } else {
    return null;
  }
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** 金額（カンマ・円記号・▲△・括弧のマイナス）を整数にする。読めなければ null、空欄も null。 */
export function parseAmount(raw: string): number | null {
  const s = raw.normalize("NFKC").trim();
  if (s === "" || s === "-") return null;
  const negative = /^[▲△(（-]|[)）]$/.test(s) || s.startsWith("−");
  const digits = s.replace(/[^\d.]/g, "");
  if (digits === "" || !/\d/.test(digits)) return null;
  const n = Math.round(Number(digits));
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

// ── 列の自動判定 ──────────────────────────────────────────────────────────────

export type ColumnRole =
  | "date"
  | "description"
  | "deposit"
  | "withdrawal"
  | "amount"
  | "direction"
  | "balance"
  | "other";

export const COLUMN_ROLES: readonly ColumnRole[] = [
  "date",
  "description",
  "deposit",
  "withdrawal",
  "amount",
  "direction",
  "balance",
  "other",
];

/** 見出しの語句 → 役割。先に書いたものを優先する。 */
const HEADER_PATTERNS: readonly (readonly [ColumnRole, RegExp])[] = [
  ["balance", /残高/],
  ["direction", /入出金(区分|種別)|取引(区分|種別)|入払|入出区分|^区分$|貸借/],
  ["amount", /入出金/],
  ["deposit", /入金|預入|お預|預り|受取|収入|貸方/],
  ["withdrawal", /出金|引出|お引|支払|支出|借方/],
  ["amount", /金額/],
  ["date", /日付|取引日|年月日|勘定日|お取引日|利用日|^日$|^年月日$|日時/],
  [
    "description",
    /摘要|内容|取扱|相手|名義|振込人|支払先|取引先|備考|メモ|詳細/,
  ],
];

export function roleOfHeader(header: string): ColumnRole {
  const h = header.normalize("NFKC").replace(/\s/g, "");
  if (h === "") return "other";
  for (const [role, pattern] of HEADER_PATTERNS) {
    if (pattern.test(h)) return role;
  }
  return "other";
}

export interface ColumnMapping {
  /** 見出し行の番号（見出し無しなら -1）。 */
  headerRow: number;
  roles: ColumnRole[];
}

function hasRequired(roles: readonly ColumnRole[]): boolean {
  const has = (r: ColumnRole) => roles.includes(r);
  return has("date") && (has("amount") || has("deposit") || has("withdrawal"));
}

/**
 * 見出し行を探して列の役割を決める。決められなければ null（サーバで Jev に聞く）。
 * 見出しが無い CSV は、値の形（日付・金額）から決める。
 */
export function detectColumns(rows: readonly string[][]): ColumnMapping | null {
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const roles = rows[i].map(roleOfHeader);
    if (roles.filter((r) => r !== "other").length >= 2 && hasRequired(roles)) {
      return { headerRow: i, roles };
    }
  }
  return detectHeaderless(rows);
}

function detectHeaderless(rows: readonly string[][]): ColumnMapping | null {
  const sample = rows
    .slice(0, 30)
    .filter((r) => r.some((c) => parseDate(c) !== null));
  if (sample.length === 0) return null;
  const width = Math.max(...sample.map((r) => r.length));
  const roles: ColumnRole[] = Array.from({ length: width }, () => "other");

  const share = (col: number, test: (v: string) => boolean) =>
    sample.filter((r) => test(r[col] ?? "")).length / sample.length;

  const dateCol = roles.findIndex(
    (_, c) => share(c, (v) => parseDate(v) !== null) > 0.8,
  );
  if (dateCol < 0) return null;
  roles[dateCol] = "date";

  const numeric = roles
    .map((_, c) => c)
    .filter(
      (c) => c !== dateCol && share(c, (v) => parseAmount(v) !== null) > 0.3,
    );
  const text = roles
    .map((_, c) => c)
    .filter(
      (c) =>
        c !== dateCol &&
        !numeric.includes(c) &&
        share(c, (v) => v.trim() !== "") > 0.5,
    );
  for (const c of text) roles[c] = "description";

  // 数値列が 3 つ以上 → 左から 出金・入金・残高、2 つ → 金額・残高、1 つ → 金額
  if (numeric.length >= 3) {
    [roles[numeric[0]], roles[numeric[1]], roles[numeric[numeric.length - 1]]] =
      ["withdrawal", "deposit", "balance"];
  } else if (numeric.length === 2) {
    [roles[numeric[0]], roles[numeric[1]]] = ["amount", "balance"];
  } else if (numeric.length === 1) {
    roles[numeric[0]] = "amount";
  } else {
    return null;
  }
  return hasRequired(roles) ? { headerRow: -1, roles } : null;
}

// ── 行の取り出し ──────────────────────────────────────────────────────────────

export interface ExtractResult {
  rows: ParsedBankRow[];
  /** 日付や金額が読めず取り込めなかった行数。 */
  skipped: number;
}

interface RawTx {
  date: string;
  description: string;
  /** 符号付き金額。方向が分からなければ null（絶対値のみ rawAbs）。 */
  signed: number | null;
  abs: number;
  balance?: number;
}

function directionSign(text: string): 1 | -1 | null {
  const t = text.normalize("NFKC").trim();
  if (t === "入") return 1;
  if (t === "出") return -1;
  if (/入金|預入|受取|収入|貸方|credit|deposit/i.test(t)) return 1;
  if (/出金|引出|支払|支出|借方|debit|withdraw/i.test(t)) return -1;
  return null;
}

/** 列の役割に従って取引を取り出し、古い順に並べて重複排除用のキーを付ける。 */
export function extractRows(
  rows: readonly string[][],
  mapping: ColumnMapping,
): ExtractResult {
  const col = (role: ColumnRole) =>
    mapping.roles.flatMap((r, i) => (r === role ? [i] : []));
  const [dateCol] = col("date");
  const [depositCol] = col("deposit");
  const [withdrawalCol] = col("withdrawal");
  const [amountCol] = col("amount");
  const [directionCol] = col("direction");
  const [balanceCol] = col("balance");
  const descCols = col("description");

  const raws: RawTx[] = [];
  let skipped = 0;
  // 金額列が「出金だけ負の数」で表されている CSV か（正の数は入金とみなせる）
  let usesNegativeForWithdrawal = false;
  for (const row of rows.slice(mapping.headerRow + 1)) {
    const date = dateCol === undefined ? null : parseDate(row[dateCol] ?? "");
    // 日付のない行（見出し・合計行・注記）は取引ではないので数えない
    if (date === null) continue;

    const deposit =
      depositCol === undefined ? null : parseAmount(row[depositCol] ?? "");
    const withdrawal =
      withdrawalCol === undefined
        ? null
        : parseAmount(row[withdrawalCol] ?? "");
    let signed: number | null = null;
    let abs = 0;
    if ((deposit ?? 0) !== 0 || (withdrawal ?? 0) !== 0) {
      signed = Math.abs(deposit ?? 0) - Math.abs(withdrawal ?? 0);
      abs = Math.abs(signed);
    } else if (amountCol !== undefined) {
      const amount = parseAmount(row[amountCol] ?? "");
      if (amount !== null) {
        abs = Math.abs(amount);
        const sign =
          directionCol === undefined
            ? null
            : directionSign(row[directionCol] ?? "");
        if (sign !== null) signed = sign * abs;
        else if (amount < 0) {
          signed = amount;
          usesNegativeForWithdrawal = true;
        } else signed = null;
      }
    }
    if (abs === 0) {
      skipped++;
      continue;
    }

    raws.push({
      date,
      description: normalizeText(descCols.map((c) => row[c] ?? "").join(" ")),
      signed,
      abs,
      balance:
        balanceCol === undefined
          ? undefined
          : (parseAmount(row[balanceCol] ?? "") ?? undefined),
    });
  }

  const chronological = orderChronologically(raws);
  resolveDirections(chronological);
  if (usesNegativeForWithdrawal) {
    for (const tx of chronological) tx.signed ??= tx.abs;
  }

  const seen = new Map<string, number>();
  const result: ParsedBankRow[] = [];
  chronological.forEach((tx, i) => {
    if (tx.signed === null) {
      skipped++;
      return;
    }
    const base = `${tx.date}|${tx.signed}|${tx.description}|${tx.balance ?? ""}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    result.push({
      key: `${base}#${n}`,
      date: tx.date,
      seq: i,
      description: tx.description,
      amount: tx.signed,
      balance: tx.balance,
    });
  });
  return { rows: result, skipped };
}

/** ファイルが新しい順なら反転して、古い順にする（同じ日の中の順序はファイルの順序を保つ）。 */
function orderChronologically(raws: RawTx[]): RawTx[] {
  if (raws.length < 2) return raws;
  let asc = 0;
  let desc = 0;
  for (let i = 1; i < raws.length; i++) {
    if (raws[i].date > raws[i - 1].date) asc++;
    else if (raws[i].date < raws[i - 1].date) desc++;
  }
  return desc > asc ? [...raws].reverse() : raws;
}

/** 入出金の区別がない CSV は、直前の行との残高差から符号を決める（先頭行は決められない）。 */
function resolveDirections(txs: RawTx[]): void {
  for (let i = 1; i < txs.length; i++) {
    const tx = txs[i];
    const prev = txs[i - 1].balance;
    if (tx.signed !== null || tx.balance === undefined || prev === undefined)
      continue;
    const diff = tx.balance - prev;
    if (diff === tx.abs) tx.signed = tx.abs;
    else if (diff === -tx.abs) tx.signed = -tx.abs;
  }
}

// ── 摘要の正規化・請求書の照合 ─────────────────────────────────────────────────

/** 同じ取引先・同じ用途の摘要を同一視するためのキー（数字・日付・空白を除く）。 */
export function descriptionKey(description: string): string {
  return normalizeText(description)
    .replace(/[\d\s/.\-年月日]+/g, "")
    .toLowerCase();
}

/** 振込手数料などで入金額が請求額より少ない場合の許容額（税込 1,100 円まで）。 */
export const MAX_TRANSFER_FEE = 1_100;

export interface InvoiceCandidate {
  doc: DocumentRecord;
  total: number;
}

export interface InvoiceCandidates {
  /** 金額が一致。 */
  exact: InvoiceCandidate[];
  /** 振込手数料を引いた額と一致しうる。 */
  nearWithFee: InvoiceCandidate[];
}

/** 入金に対応しうる未入金の請求書を挙げる。 */
export function findInvoiceCandidates(
  amount: number,
  unpaidInvoices: readonly DocumentRecord[],
): InvoiceCandidates {
  const exact: InvoiceCandidate[] = [];
  const nearWithFee: InvoiceCandidate[] = [];
  if (amount <= 0) return { exact, nearWithFee };
  for (const doc of unpaidInvoices) {
    const total = summarize(doc.items).total;
    if (total === amount) exact.push({ doc, total });
    else if (total > amount && total - amount <= MAX_TRANSFER_FEE) {
      nearWithFee.push({ doc, total });
    }
  }
  const byOldest = (a: InvoiceCandidate, b: InvoiceCandidate) =>
    a.doc.issueDate.localeCompare(b.doc.issueDate);
  return {
    exact: exact.sort(byOldest),
    nearWithFee: nearWithFee.sort(byOldest),
  };
}

/** 照合の対象になる請求書（請求書で、発行済みか送付済み）。 */
export function isUnpaidInvoice(doc: DocumentRecord): boolean {
  return (
    doc.type === "invoice" && (doc.status === "issued" || doc.status === "sent")
  );
}
