/**
 * 会計ドメイン。請求書・経費・銀行明細から自動で仕訳を作り、損益計算書（PL）・貸借対照表（BS）・
 * 月次推移・総勘定元帳を求める純関数群。外部依存なし。
 *
 * 会計仮定:
 * - 請求書（発行済・送付済・入金済）: 発行日に 売掛金 / 売上高 + 仮受消費税
 * - 経費: 利用日に 費目 / 未払金（金額は税込で計上し、仮払消費税は分けない）
 * - 銀行明細（取り込み済み）: 入金は 現金預金 / 相手科目、出金は 相手科目 / 現金預金。
 *   請求書に照合した入金は 現金預金 / 売掛金（入金額が請求額より少なければ差額を支払手数料にする）
 * - 銀行明細に残高があれば、最も古い取引の前の残高を 元入金（期首残高）として計上する
 * - 銀行明細が無い間の推定: 入金済の請求書は入金日（ステータスを更新した日）に 現金預金 / 売掛金、
 *   経費は引落月（expectedDebitMonth、無ければ翌月）の 27 日に 未払金 / 現金預金。
 *   銀行明細が照合済み・または対象期間に含まれる分は、推定を出さず明細を正とする
 * - 期首残高の明細が無ければ 0。繰越利益は過去期間の損益の累計で求める
 */
import type { BankTransaction } from "./bank.ts";
import type { DocumentRecord } from "./documents.ts";
import type { Expense } from "./expense.ts";
import { EXPENSE_CATEGORIES } from "./expense.ts";
import { summarize } from "./money.ts";
import { toIsoDate, toYearMonth } from "./dates.ts";

export const ACCOUNT_KINDS = [
  "asset",
  "liability",
  "equity",
  "revenue",
  "expense",
] as const;
export type AccountKind = (typeof ACCOUNT_KINDS)[number];

export const ACCOUNT_KIND_LABELS: Record<AccountKind, string> = {
  asset: "資産",
  liability: "負債",
  equity: "純資産",
  revenue: "収益",
  expense: "費用",
};

export const ACCOUNT = {
  cash: "現金預金",
  receivable: "売掛金",
  payable: "未払金",
  outputTax: "仮受消費税",
  capital: "元入金",
  retainedEarnings: "繰越利益",
  currentEarnings: "当期純利益",
  sales: "売上高",
} as const;

/** 勘定科目名 → 区分。仕訳に現れる科目はすべてここで分類する。 */
const ACCOUNT_KIND_BY_NAME: ReadonlyMap<string, AccountKind> = new Map<
  string,
  AccountKind
>([
  [ACCOUNT.cash, "asset"],
  [ACCOUNT.receivable, "asset"],
  [ACCOUNT.payable, "liability"],
  [ACCOUNT.outputTax, "liability"],
  [ACCOUNT.capital, "equity"],
  [ACCOUNT.sales, "revenue"],
  // 銀行明細で使う科目
  ["仮払金", "asset"],
  ["役員貸付金", "asset"],
  ["仮受金", "liability"],
  ["役員借入金", "liability"],
  ["借入金", "liability"],
  ["受取利息", "revenue"],
  ["雑収入", "revenue"],
  ["支払利息", "expense"],
  ...EXPENSE_CATEGORIES.map((c): [string, AccountKind] => [c, "expense"]),
]);

export function accountKind(name: string): AccountKind {
  return ACCOUNT_KIND_BY_NAME.get(name) ?? "expense";
}

export function isBalanceSheetAccount(name: string): boolean {
  const kind = accountKind(name);
  return kind === "asset" || kind === "liability" || kind === "equity";
}

/** 貸借対照表・試算表での表示順（資産 → 負債 → 純資産）。 */
const ACCOUNT_ORDER: readonly string[] = [
  ACCOUNT.cash,
  ACCOUNT.receivable,
  "仮払金",
  "役員貸付金",
  ACCOUNT.payable,
  ACCOUNT.outputTax,
  "仮受金",
  "役員借入金",
  "借入金",
  ACCOUNT.capital,
  ACCOUNT.sales,
  "受取利息",
  "雑収入",
  ...EXPENSE_CATEGORIES,
  "支払利息",
];

function accountRank(name: string): number {
  const i = ACCOUNT_ORDER.indexOf(name);
  return i < 0 ? ACCOUNT_ORDER.length : i;
}

/** 経費の引落日（引落月の 27 日）。 */
const CARD_DEBIT_DAY = "27";

export interface JournalLine {
  account: string;
  side: "debit" | "credit";
  amount: number;
}

export type JournalSource =
  "invoice" | "payment" | "expense" | "settlement" | "bank" | "opening";

export interface JournalEntry {
  id: string;
  /** YYYY-MM-DD */
  date: string;
  description: string;
  source: JournalSource;
  /** 元データへのリンク（請求書の詳細など）。 */
  href?: string;
  lines: JournalLine[];
}

export interface DateRange {
  from: string;
  to: string;
}

function debit(account: string, amount: number): JournalLine {
  return { account, side: "debit", amount };
}

function credit(account: string, amount: number): JournalLine {
  return { account, side: "credit", amount };
}

function nextMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return toYearMonth(new Date(y, m, 1));
}

function invoiceEntries(
  doc: DocumentRecord,
  partyName: string,
): JournalEntry[] {
  const { subtotal, taxTotal, total } = summarize(doc.items);
  const href = `/documents/${doc.id}`;
  const label = `${partyName} ${doc.number}`.trim();
  const sales: JournalEntry = {
    id: `inv-${doc.id}`,
    date: doc.issueDate,
    description: `売上 ${label}`,
    source: "invoice",
    href,
    lines: [
      debit(ACCOUNT.receivable, total),
      credit(ACCOUNT.sales, subtotal),
      ...(taxTotal > 0 ? [credit(ACCOUNT.outputTax, taxTotal)] : []),
    ],
  };
  if (doc.status !== "paid") return [sales];

  const paidOn = doc.updatedAt.slice(0, 10);
  return [
    sales,
    {
      id: `pay-${doc.id}`,
      date: paidOn > doc.issueDate ? paidOn : doc.issueDate,
      description: `入金 ${label}`,
      source: "payment",
      href,
      lines: [debit(ACCOUNT.cash, total), credit(ACCOUNT.receivable, total)],
    },
  ];
}

function expenseEntries(expense: Expense): JournalEntry[] {
  const label = expense.merchant;
  const debitMonth =
    expense.expectedDebitMonth ?? nextMonth(expense.date.slice(0, 7));
  return [
    {
      id: `exp-${expense.id}`,
      date: expense.date,
      description: `${expense.category} ${label}`,
      source: "expense",
      href: "/expenses",
      lines: [
        debit(expense.category, expense.amount),
        credit(ACCOUNT.payable, expense.amount),
      ],
    },
    {
      id: `set-${expense.id}`,
      date: `${debitMonth}-${CARD_DEBIT_DAY}`,
      description: `引落 ${label}`,
      source: "settlement",
      href: "/expenses",
      lines: [
        debit(ACCOUNT.payable, expense.amount),
        credit(ACCOUNT.cash, expense.amount),
      ],
    },
  ];
}

/** 銀行明細 1 件の仕訳。請求書に照合した入金は売掛金を消し込み、不足分は支払手数料にする。 */
function bankEntry(
  tx: BankTransaction,
  invoicesById: ReadonlyMap<string, DocumentRecord>,
): JournalEntry {
  const inflow = tx.amount > 0;
  const amount = Math.abs(tx.amount);
  const base = {
    id: `bank-${tx.id}`,
    date: tx.date,
    source: "bank" as const,
    href: "/bank",
  };

  const matched = tx.matchedDocumentId
    ? invoicesById.get(tx.matchedDocumentId)
    : undefined;
  if (inflow && matched) {
    const total = summarize(matched.items).total;
    const fee = Math.max(total - amount, 0);
    return {
      ...base,
      description: `入金 ${matched.number} ${tx.description}`.trim(),
      href: `/documents/${matched.id}`,
      lines: [
        debit(ACCOUNT.cash, amount),
        ...(fee > 0 ? [debit("支払手数料", fee)] : []),
        credit(ACCOUNT.receivable, amount + fee),
      ],
    };
  }
  return {
    ...base,
    description: `${inflow ? "入金" : "出金"} ${tx.description}`.trim(),
    lines: inflow
      ? [debit(ACCOUNT.cash, amount), credit(tx.account, amount)]
      : [debit(tx.account, amount), credit(ACCOUNT.cash, amount)],
  };
}

/** 最も古い取引の前の残高（残高付きの明細がある場合のみ）。 */
function openingBalance(txs: readonly BankTransaction[]): {
  date: string;
  amount: number;
} | null {
  const first = [...txs].sort(
    (a, b) => a.date.localeCompare(b.date) || a.seq - b.seq,
  )[0];
  if (!first || first.balance === undefined) return null;
  const amount = first.balance - first.amount;
  return amount === 0 ? null : { date: first.date, amount };
}

/** 請求書・経費・銀行明細から仕訳を作る。日付の古い順。 */
export function buildJournal(
  documents: readonly DocumentRecord[],
  expenses: readonly Expense[],
  partyNames: ReadonlyMap<string, string> = new Map(),
  bankTransactions: readonly BankTransaction[] = [],
): JournalEntry[] {
  const bankDates = bankTransactions.map((t) => t.date).sort();
  const coverage =
    bankDates.length > 0
      ? { from: bankDates[0], to: bankDates[bankDates.length - 1] }
      : null;
  const matchedIds = new Set(
    bankTransactions.flatMap((t) =>
      t.matchedDocumentId ? [t.matchedDocumentId] : [],
    ),
  );

  const entries: JournalEntry[] = [];
  const invoices = documents.filter(
    (d) => d.type === "invoice" && d.status !== "draft" && d.status !== "void",
  );
  for (const doc of invoices) {
    for (const entry of invoiceEntries(
      doc,
      partyNames.get(doc.partyId) ?? "",
    )) {
      // 銀行明細に照合済みの入金は、推定の入金仕訳を出さない
      if (entry.source === "payment" && matchedIds.has(doc.id)) continue;
      entries.push(entry);
    }
  }
  for (const expense of expenses) {
    for (const entry of expenseEntries(expense)) {
      // 明細の対象期間内の引落は、実際の出金（明細）を正とする
      const covered =
        coverage && entry.date >= coverage.from && entry.date <= coverage.to;
      if (entry.source === "settlement" && covered) continue;
      entries.push(entry);
    }
  }

  const invoicesById = new Map(documents.map((d) => [d.id, d]));
  for (const tx of bankTransactions) entries.push(bankEntry(tx, invoicesById));

  const opening = openingBalance(bankTransactions);
  if (opening) {
    entries.push({
      id: "bank-opening",
      date: opening.date,
      description: "期首残高（銀行明細の残高より）",
      source: "opening",
      href: "/bank",
      lines:
        opening.amount > 0
          ? [
              debit(ACCOUNT.cash, opening.amount),
              credit(ACCOUNT.capital, opening.amount),
            ]
          : [
              debit(ACCOUNT.capital, -opening.amount),
              credit(ACCOUNT.cash, -opening.amount),
            ],
    });
  }

  return entries.sort(
    (a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id),
  );
}

export function entriesInRange(
  entries: readonly JournalEntry[],
  range: Partial<DateRange>,
): JournalEntry[] {
  return entries.filter(
    (e) =>
      (range.from === undefined || e.date >= range.from) &&
      (range.to === undefined || e.date <= range.to),
  );
}

export interface AccountTotals {
  debit: number;
  credit: number;
}

/** 科目ごとの借方・貸方の合計。 */
export function accountTotals(
  entries: readonly JournalEntry[],
): Map<string, AccountTotals> {
  const totals = new Map<string, AccountTotals>();
  for (const entry of entries) {
    for (const line of entry.lines) {
      const t = totals.get(line.account) ?? { debit: 0, credit: 0 };
      t[line.side] += line.amount;
      totals.set(line.account, t);
    }
  }
  return totals;
}

/** 科目の残高（資産・費用は借方残、その他は貸方残を正とする）。 */
export function accountBalance(name: string, t: AccountTotals): number {
  const kind = accountKind(name);
  return kind === "asset" || kind === "expense"
    ? t.debit - t.credit
    : t.credit - t.debit;
}

export interface AmountRow {
  account: string;
  amount: number;
}

function rowsOfKind(
  totals: ReadonlyMap<string, AccountTotals>,
  kind: AccountKind,
): AmountRow[] {
  return [...totals.entries()]
    .filter(([name]) => accountKind(name) === kind)
    .map(([account, t]) => ({ account, amount: accountBalance(account, t) }))
    .filter((r) => r.amount !== 0)
    .sort((a, b) => accountRank(a.account) - accountRank(b.account));
}

function sum(rows: readonly AmountRow[]): number {
  return rows.reduce((s, r) => s + r.amount, 0);
}

export interface ProfitAndLoss {
  revenues: AmountRow[];
  expenses: AmountRow[];
  totalRevenue: number;
  totalExpense: number;
  /** 売上高 − 費用。 */
  netIncome: number;
}

export function profitAndLoss(
  entries: readonly JournalEntry[],
  range: Partial<DateRange>,
): ProfitAndLoss {
  const totals = accountTotals(entriesInRange(entries, range));
  const revenues = rowsOfKind(totals, "revenue");
  const expenses = rowsOfKind(totals, "expense");
  const totalRevenue = sum(revenues);
  const totalExpense = sum(expenses);
  return {
    revenues,
    expenses,
    totalRevenue,
    totalExpense,
    netIncome: totalRevenue - totalExpense,
  };
}

export interface BalanceSheet {
  assets: AmountRow[];
  liabilities: AmountRow[];
  equity: AmountRow[];
  totalAssets: number;
  totalLiabilities: number;
  totalEquity: number;
  /** 資産 = 負債 + 純資産 が成り立つか。 */
  balanced: boolean;
}

/**
 * 貸借対照表。期首（fiscalStart）より前の損益は「繰越利益」、期首以降は「当期純利益」として純資産に含める。
 */
export function balanceSheet(
  entries: readonly JournalEntry[],
  asOf: string,
  fiscalStart: string,
): BalanceSheet {
  const upToDate = entriesInRange(entries, { to: asOf });
  const totals = accountTotals(upToDate);
  const assets = rowsOfKind(totals, "asset");
  const liabilities = rowsOfKind(totals, "liability");
  const equity = rowsOfKind(totals, "equity");

  const prior = profitAndLoss(entries, { to: dayBefore(fiscalStart) });
  const current = profitAndLoss(entries, { from: fiscalStart, to: asOf });
  if (prior.netIncome !== 0) {
    equity.push({ account: ACCOUNT.retainedEarnings, amount: prior.netIncome });
  }
  equity.push({ account: ACCOUNT.currentEarnings, amount: current.netIncome });

  const totalAssets = sum(assets);
  const totalLiabilities = sum(liabilities);
  const totalEquity = sum(equity);
  return {
    assets,
    liabilities,
    equity,
    totalAssets,
    totalLiabilities,
    totalEquity,
    balanced: totalAssets === totalLiabilities + totalEquity,
  };
}

function dayBefore(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const prev = new Date(y, m - 1, d - 1);
  return toIsoDate(prev);
}

export interface FiscalYear {
  /** 期の開始年（2026年4月始まりなら 2026）。 */
  year: number;
  from: string;
  to: string;
  label: string;
}

/** `date` を含む会計年度。startMonth=1 なら暦年。 */
export function fiscalYearOf(date: string, startMonth = 1): FiscalYear {
  const [y, m] = date.split("-").map(Number);
  return fiscalYear(m >= startMonth ? y : y - 1, startMonth);
}

export function fiscalYear(year: number, startMonth = 1): FiscalYear {
  const from = `${year}-${String(startMonth).padStart(2, "0")}-01`;
  const end = new Date(year, startMonth - 1 + 12, 0);
  return {
    year,
    from,
    to: toIsoDate(end),
    label: startMonth === 1 ? `${year}年度` : `${year}年${startMonth}月期`,
  };
}

/** 期内の月（YYYY-MM）を古い順に並べる。 */
export function monthsOf(fy: FiscalYear): string[] {
  const [y, m] = fy.from.split("-").map(Number);
  return Array.from({ length: 12 }, (_, i) =>
    toYearMonth(new Date(y, m - 1 + i, 1)),
  );
}

export interface MonthlyPnl {
  month: string;
  revenue: number;
  expense: number;
  netIncome: number;
}

export function monthlyProfitAndLoss(
  entries: readonly JournalEntry[],
  months: readonly string[],
): MonthlyPnl[] {
  return months.map((month) => {
    const pl = profitAndLoss(entries, {
      from: `${month}-01`,
      to: `${month}-31`,
    });
    return {
      month,
      revenue: pl.totalRevenue,
      expense: pl.totalExpense,
      netIncome: pl.netIncome,
    };
  });
}

export interface LedgerRow {
  entry: JournalEntry;
  debit: number;
  credit: number;
  /** この行までの残高。 */
  balance: number;
}

export interface Ledger {
  account: string;
  /** 期間開始前の残高。 */
  opening: number;
  rows: LedgerRow[];
  totalDebit: number;
  totalCredit: number;
  closing: number;
}

/** 総勘定元帳（科目別の取引履歴と残高推移）。 */
export function ledger(
  entries: readonly JournalEntry[],
  account: string,
  range: DateRange,
): Ledger {
  // 損益の科目は期ごとに 0 から始まる。貸借の科目だけ前期末の残高を繰り越す。
  const carriesOver = isBalanceSheetAccount(account);
  const opening = carriesOver
    ? accountBalance(
        account,
        accountTotals(
          entriesInRange(entries, { to: dayBefore(range.from) }),
        ).get(account) ?? { debit: 0, credit: 0 },
      )
    : 0;
  const sign = accountBalance(account, { debit: 1, credit: 0 });

  let balance = opening;
  let totalDebit = 0;
  let totalCredit = 0;
  const rows: LedgerRow[] = [];
  for (const entry of entriesInRange(entries, range)) {
    const mine = entry.lines.filter((l) => l.account === account);
    if (mine.length === 0) continue;
    const d = mine
      .filter((l) => l.side === "debit")
      .reduce((s, l) => s + l.amount, 0);
    const c = mine
      .filter((l) => l.side === "credit")
      .reduce((s, l) => s + l.amount, 0);
    balance += sign * (d - c);
    totalDebit += d;
    totalCredit += c;
    rows.push({ entry, debit: d, credit: c, balance });
  }
  return { account, opening, rows, totalDebit, totalCredit, closing: balance };
}

/** 仕訳に現れた科目（元帳のセレクタ用）。 */
export function usedAccounts(entries: readonly JournalEntry[]): string[] {
  const names = new Set<string>();
  for (const e of entries) for (const l of e.lines) names.add(l.account);
  return [...names].sort((a, b) => accountRank(a) - accountRank(b));
}
