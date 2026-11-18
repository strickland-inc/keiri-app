import assert from "node:assert/strict";
import test from "node:test";
import type { Expense } from "./expense.ts";
import type { DocumentRecord } from "./documents.ts";
import type { Party } from "./party.ts";
import { fiscalYear } from "./fiscal-year.ts";
import { SGA_ORDER, buildClosing } from "./closing.ts";

const sampleCompany = {
  fiscalYearEndMonth: 9,
  firstFiscalYearEnd: "2023-09-30",
};
const fy = fiscalYear(sampleCompany, 3); // 2024-10-01〜2025-09-30

function expense(
  patch: Partial<Expense> &
    Pick<Expense, "id" | "date" | "amount" | "category">,
): Expense {
  return {
    merchant: "テスト加盟店",
    source: "楽天カード",
    note: "",
    createdAt: "2024-10-01T00:00:00.000Z",
    updatedAt: "2024-10-01T00:00:00.000Z",
    ...patch,
  };
}

const party: Party = {
  id: "party-1",
  name: "株式会社サンプル",
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
};

function document(
  patch: Partial<DocumentRecord> &
    Pick<DocumentRecord, "id" | "issueDate" | "status">,
): DocumentRecord {
  return {
    type: "invoice",
    number: "0001",
    issuerId: "issuer-sample",
    partyId: "party-1",
    title: "システム開発業務",
    items: [{ name: "作業費", quantity: 1, unitPrice: 100_000, taxRate: 0.1 }],
    notes: "",
    createdAt: "2024-10-01T00:00:00.000Z",
    updatedAt: "2024-10-01T00:00:00.000Z",
    ...patch,
  };
}

test("期外の経費は集計から除外する", () => {
  const report = buildClosing({
    fiscalYear: fy,
    expenses: [
      expense({
        id: "in",
        date: "2024-10-05",
        amount: 3_000,
        category: "通信費",
      }),
      expense({
        id: "out-before",
        date: "2024-09-30",
        amount: 5_000,
        category: "通信費",
      }),
      expense({
        id: "out-after",
        date: "2025-10-01",
        amount: 5_000,
        category: "通信費",
      }),
    ],
    documents: [],
    revenues: [],
    parties: [],
  });

  assert.equal(report.sga.total, 3_000);
  const tsushin = report.sga.byCategory.find((c) => c.category === "通信費");
  assert.equal(tsushin?.count, 1);
  assert.equal(tsushin?.amount, 3_000);
});

test("要確認は sga に入らず pending に分類する", () => {
  const report = buildClosing({
    fiscalYear: fy,
    expenses: [
      expense({
        id: "ok",
        date: "2024-10-10",
        amount: 4_000,
        category: "旅費交通費",
      }),
      expense({
        id: "check",
        date: "2024-10-11",
        amount: 9_000,
        category: "要確認",
      }),
    ],
    documents: [],
    revenues: [],
    parties: [],
  });

  assert.equal(report.sga.total, 4_000);
  assert.equal(report.pending.total, 9_000);
  assert.equal(report.pending.count, 1);
  assert.equal(report.pending.items[0]?.id, "check");
  assert.ok(
    report.sga.byCategory.every((c) => c.category !== ("要確認" as never)),
  );
});

test("coverage は期内12か月分あり、明細の無い月は gaps に入る", () => {
  const report = buildClosing({
    fiscalYear: fy,
    expenses: [
      expense({
        id: "only-oct",
        date: "2024-10-15",
        amount: 1_000,
        category: "消耗品費",
      }),
    ],
    documents: [],
    revenues: [],
    parties: [],
  });

  assert.equal(report.coverage.length, 12);
  assert.deepEqual(
    report.coverage.map((c) => c.month),
    [
      "2024-10",
      "2024-11",
      "2024-12",
      "2025-01",
      "2025-02",
      "2025-03",
      "2025-04",
      "2025-05",
      "2025-06",
      "2025-07",
      "2025-08",
      "2025-09",
    ],
  );
  const oct = report.coverage.find((c) => c.month === "2024-10");
  assert.equal(oct?.count, 1);
  assert.equal(oct?.amount, 1_000);
  assert.ok(report.gaps.includes("2024-11"));
  assert.equal(report.gaps.length, 11);
});

test("revenue.documentId が期内 invoice を指すと二重計上しない", () => {
  const doc = document({
    id: "doc-1",
    issueDate: "2024-11-01",
    status: "paid",
  });

  const report = buildClosing({
    fiscalYear: fy,
    expenses: [],
    documents: [doc],
    revenues: [
      {
        id: "rev-1",
        issuerId: "issuer-sample",
        date: "2024-11-05",
        partyId: "party-1",
        partyName: "株式会社サンプル",
        amount: 110_000,
        description: "システム開発業務 入金",
        source: "通帳",
        documentId: "doc-1",
        createdAt: "2024-11-05T00:00:00.000Z",
        updatedAt: "2024-11-05T00:00:00.000Z",
      },
    ],
    parties: [party],
  });

  assert.equal(report.revenue.fromDocuments, 0);
  assert.equal(report.revenue.fromRevenues, 110_000);
  assert.equal(report.revenue.total, 110_000);
  assert.equal(report.revenue.lines.length, 1);
});

test("台帳に載らない請求書は税抜金額で売上に入る", () => {
  const doc = document({
    id: "doc-2",
    issueDate: "2024-12-01",
    status: "sent",
  });

  const report = buildClosing({
    fiscalYear: fy,
    expenses: [],
    documents: [doc],
    revenues: [],
    parties: [party],
  });

  assert.equal(report.revenue.fromDocuments, 100_000);
  assert.equal(report.revenue.total, 100_000);
  assert.equal(report.revenue.lines[0]?.partyName, "株式会社サンプル");
});

test("SGA_ORDER の順で byCategory が並ぶ", () => {
  const report = buildClosing({
    fiscalYear: fy,
    expenses: [
      expense({
        id: "a",
        date: "2024-10-01",
        amount: 1_000,
        category: "諸会費",
      }),
      expense({
        id: "b",
        date: "2024-10-01",
        amount: 2_000,
        category: "福利厚生費",
      }),
    ],
    documents: [],
    revenues: [],
    parties: [],
  });

  assert.deepEqual(
    report.sga.byCategory.map((c) => c.category),
    SGA_ORDER,
  );
});

test("operatingIncome は revenue.total - sga.total で、要確認は含めない", () => {
  const doc = document({
    id: "doc-3",
    issueDate: "2024-10-10",
    status: "issued",
  });

  const report = buildClosing({
    fiscalYear: fy,
    expenses: [
      expense({
        id: "sga-1",
        date: "2024-10-10",
        amount: 30_000,
        category: "地代家賃",
      }),
      expense({
        id: "check-1",
        date: "2024-10-11",
        amount: 999_999,
        category: "要確認",
      }),
    ],
    documents: [doc],
    revenues: [],
    parties: [party],
  });

  assert.equal(report.revenue.total, 100_000);
  assert.equal(report.sga.total, 30_000);
  assert.equal(report.operatingIncome, 70_000);
});
