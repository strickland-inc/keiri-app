/**
 * 決算集計ドメイン。期（FiscalYear）内の経費・売上（帳票 + 台帳）から
 * 試算表（損益）・販管費内訳・要確認一覧・月別カバレッジを組み立てる。
 */
import type { Expense, ExpenseCategory } from "./expense";
import type { DocumentRecord } from "./documents";
import type { Revenue } from "./revenue";
import type { Party } from "./party";
import type { FiscalYear } from "./fiscal-year";
import { summarize } from "./money.ts";

export interface RevenueLine {
  date: string;
  partyName: string;
  description: string;
  amount: number;
  source: string;
}

export interface ClosingInput {
  fiscalYear: FiscalYear;
  expenses: readonly Expense[];
  documents: readonly DocumentRecord[];
  revenues: readonly Revenue[];
  parties: readonly Party[];
}

export interface ClosingReport {
  fiscalYear: FiscalYear;
  revenue: {
    total: number;
    fromDocuments: number;
    fromRevenues: number;
    lines: RevenueLine[];
  };
  sga: {
    total: number;
    byCategory: { category: ExpenseCategory; amount: number; count: number }[];
  };
  pending: { total: number; count: number; items: Expense[] };
  operatingIncome: number;
  coverage: { month: string; count: number; amount: number }[];
  gaps: string[];
}

// 販管費の表示順。「要確認」以外の全費目を含む。
export const SGA_ORDER: ExpenseCategory[] = [
  "福利厚生費",
  "外注費",
  "広告宣伝費",
  "接待交際費",
  "会議費",
  "旅費交通費",
  "通信費",
  "消耗品費",
  "水道光熱費",
  "新聞図書費",
  "支払手数料",
  "車両費",
  "地代家賃",
  "雑費",
  "研修費",
  "荷造運賃",
  "修繕費",
  "保険料",
  "租税公課",
  "諸会費",
];

function inRange(date: string, from: string, to: string): boolean {
  return date >= from && date <= to;
}

function hasDocumentId(
  revenue: Revenue,
): revenue is Revenue & { documentId: string } {
  return (
    typeof revenue.documentId === "string" && revenue.documentId.length > 0
  );
}

function monthsInRange(from: string, to: string): string[] {
  const [fromYear, fromMonth] = from.split("-").map(Number);
  const [toYear, toMonth] = to.split("-").map(Number);
  const months: string[] = [];
  let year = fromYear;
  let month = fromMonth;
  while (year < toYear || (year === toYear && month <= toMonth)) {
    months.push(`${year}-${month < 10 ? `0${month}` : month}`);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return months;
}

/** 期間内の経費と売上から決算の集計を組み立てる。「要確認」の経費は販管費に入れず pending に分ける。 */
export function buildClosing(input: ClosingInput): ClosingReport {
  const { fiscalYear, expenses, documents, revenues, parties } = input;
  const { from, to } = fiscalYear;

  const periodExpenses = expenses.filter((e) => inRange(e.date, from, to));
  const periodRevenues = revenues.filter((r) => inRange(r.date, from, to));

  // Revenue.documentId が指す請求書は、期外の台帳から参照されている場合も含めて
  // fromDocuments に二重計上しない（台帳側を正とする）。
  const coveredDocumentIds = new Set(
    revenues.filter(hasDocumentId).map((r) => r.documentId),
  );

  const periodDocuments = documents.filter(
    (d) =>
      d.type === "invoice" &&
      (d.status === "issued" || d.status === "sent" || d.status === "paid") &&
      inRange(d.issueDate, from, to) &&
      !coveredDocumentIds.has(d.id),
  );

  const documentLines: RevenueLine[] = periodDocuments.map((d) => ({
    date: d.issueDate,
    partyName: parties.find((p) => p.id === d.partyId)?.name ?? d.partyId,
    description: d.title,
    amount: summarize(d.items).subtotal,
    source: "請求書",
  }));

  const revenueLines: RevenueLine[] = periodRevenues.map((r) => ({
    date: r.date,
    partyName: r.partyName,
    description: r.description,
    amount: r.amount,
    source: r.source,
  }));

  const fromDocuments = documentLines.reduce((sum, l) => sum + l.amount, 0);
  const fromRevenues = revenueLines.reduce((sum, l) => sum + l.amount, 0);
  const lines = [...documentLines, ...revenueLines].sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
  );
  const revenueTotal = fromDocuments + fromRevenues;

  const sgaExpenses = periodExpenses.filter((e) => e.category !== "要確認");
  const pendingExpenses = periodExpenses.filter((e) => e.category === "要確認");

  const byCategory = SGA_ORDER.map((category) => {
    const matched = sgaExpenses.filter((e) => e.category === category);
    return {
      category,
      amount: matched.reduce((sum, e) => sum + e.amount, 0),
      count: matched.length,
    };
  });
  const sgaTotal = byCategory.reduce((sum, c) => sum + c.amount, 0);
  const pendingTotal = pendingExpenses.reduce((sum, e) => sum + e.amount, 0);

  // 経費が1件も無い月は、取り込み漏れの疑いとして gaps に挙げる。
  const coverage = monthsInRange(from, to).map((month) => {
    const matched = periodExpenses.filter((e) => e.date.startsWith(month));
    return {
      month,
      count: matched.length,
      amount: matched.reduce((sum, e) => sum + e.amount, 0),
    };
  });
  const gaps = coverage.filter((c) => c.count === 0).map((c) => c.month);

  return {
    fiscalYear,
    revenue: { total: revenueTotal, fromDocuments, fromRevenues, lines },
    sga: { total: sgaTotal, byCategory },
    pending: {
      total: pendingTotal,
      count: pendingExpenses.length,
      items: pendingExpenses,
    },
    operatingIncome: revenueTotal - sgaTotal,
    coverage,
    gaps,
  };
}
