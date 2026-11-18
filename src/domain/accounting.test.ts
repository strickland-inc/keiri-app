import assert from "node:assert/strict";
import test from "node:test";
import type { DocumentRecord } from "./documents.ts";
import type { BankTransaction } from "./bank.ts";
import type { Expense } from "./expense.ts";
import {
  balanceSheet,
  buildJournal,
  fiscalYearOf,
  ledger,
  monthlyProfitAndLoss,
  monthsOf,
  profitAndLoss,
} from "./accounting.ts";

function invoice(patch: Partial<DocumentRecord>): DocumentRecord {
  return {
    id: "d1",
    type: "invoice",
    number: "INV-0001",
    issueDate: "2026-04-10",
    issuerId: "i1",
    partyId: "p1",
    title: "開発",
    items: [{ name: "開発", quantity: 1, unitPrice: 100_000, taxRate: 0.1 }],
    notes: "",
    status: "issued",
    createdAt: "2026-04-10T00:00:00.000Z",
    updatedAt: "2026-04-10T00:00:00.000Z",
    ...patch,
  };
}

function expense(patch: Partial<Expense>): Expense {
  return {
    id: "e1",
    date: "2026-04-15",
    merchant: "テスト商店",
    amount: 30_000,
    category: "消耗品費",
    source: "テスト",
    note: "",
    createdAt: "2026-04-15T00:00:00.000Z",
    updatedAt: "2026-04-15T00:00:00.000Z",
    ...patch,
  };
}

test("請求書は売掛金/売上高+仮受消費税の仕訳になり、下書き・無効は除く", () => {
  const journal = buildJournal(
    [
      invoice({}),
      invoice({ id: "d2", status: "draft" }),
      invoice({ id: "d3", status: "void" }),
      invoice({ id: "d4", type: "quote" }),
    ],
    [],
  );
  assert.equal(journal.length, 1);
  assert.deepEqual(
    journal[0].lines.map((l) => [l.account, l.side, l.amount]),
    [
      ["売掛金", "debit", 110_000],
      ["売上高", "credit", 100_000],
      ["仮受消費税", "credit", 10_000],
    ],
  );
});

test("入金済の請求書は入金仕訳が付く", () => {
  const journal = buildJournal(
    [invoice({ status: "paid", updatedAt: "2026-05-02T01:00:00.000Z" })],
    [],
  );
  assert.equal(journal.length, 2);
  assert.equal(journal[1].date, "2026-05-02");
  assert.deepEqual(
    journal[1].lines.map((l) => [l.account, l.side]),
    [
      ["現金預金", "debit"],
      ["売掛金", "credit"],
    ],
  );
});

test("損益計算書は売上高から費用を引いた当期純利益を求める", () => {
  const journal = buildJournal([invoice({})], [expense({})]);
  const pl = profitAndLoss(journal, { from: "2026-04-01", to: "2026-04-30" });
  assert.equal(pl.totalRevenue, 100_000);
  assert.equal(pl.totalExpense, 30_000);
  assert.equal(pl.netIncome, 70_000);
});

test("貸借対照表は常に 資産 = 負債 + 純資産 になる", () => {
  const journal = buildJournal(
    [invoice({ status: "paid", updatedAt: "2026-05-02T00:00:00.000Z" })],
    [
      expense({ date: "2026-03-20" }),
      expense({ id: "e2", expectedDebitMonth: "2026-08" }),
    ],
  );
  for (const asOf of ["2026-03-31", "2026-05-31", "2026-12-31"]) {
    const fy = fiscalYearOf(asOf, 4);
    const bs = balanceSheet(journal, asOf, fy.from);
    assert.ok(bs.balanced, `${asOf} で貸借が一致しない`);
  }
});

test("期首より前の損益は繰越利益として純資産に入る", () => {
  const journal = buildJournal([invoice({})], []);
  const bs = balanceSheet(journal, "2027-03-31", "2027-01-01");
  const names = bs.equity.map((r) => r.account);
  assert.ok(names.includes("繰越利益"));
  assert.equal(bs.equity.find((r) => r.account === "当期純利益")?.amount, 0);
});

test("経費の引落日は expectedDebitMonth、無ければ翌月の27日", () => {
  const journal = buildJournal(
    [],
    [
      expense({}),
      expense({ id: "e2", expectedDebitMonth: "2026-08" }),
      expense({ id: "e3", date: "2026-12-05" }),
    ],
  );
  const settle = journal
    .filter((e) => e.source === "settlement")
    .map((e) => e.date);
  assert.deepEqual(
    settle.sort(),
    ["2026-05-27", "2026-08-27", "2027-01-27"].sort(),
  );
});

test("会計年度は開始月で決まる", () => {
  assert.equal(fiscalYearOf("2026-03-31", 4).from, "2025-04-01");
  assert.equal(fiscalYearOf("2026-04-01", 4).to, "2027-03-31");
  assert.equal(fiscalYearOf("2026-06-01").label, "2026年度");
  assert.equal(monthsOf(fiscalYearOf("2026-06-01", 4))[0], "2026-04");
});

test("月次推移と総勘定元帳の残高が一致する", () => {
  const journal = buildJournal([invoice({})], [expense({})]);
  const monthly = monthlyProfitAndLoss(journal, ["2026-04", "2026-05"]);
  assert.equal(monthly[0].netIncome, 70_000);
  assert.equal(monthly[1].netIncome, 0);

  const book = ledger(journal, "売掛金", {
    from: "2026-04-01",
    to: "2026-12-31",
  });
  assert.equal(book.closing, 110_000);
  assert.equal(book.rows.length, 1);
});

test("総勘定元帳は貸借の科目だけ前期から繰り越し、損益の科目は期首が 0", () => {
  const journal = buildJournal([invoice({})], [expense({})]);
  const next = { from: "2027-01-01", to: "2027-12-31" };
  assert.equal(ledger(journal, "売掛金", next).opening, 110_000);
  assert.equal(ledger(journal, "売上高", next).opening, 0);
  assert.equal(ledger(journal, "消耗品費", next).opening, 0);
});

function bank(patch: Partial<BankTransaction>): BankTransaction {
  return {
    id: "b1",
    key: "k",
    date: "2026-04-20",
    seq: 0,
    description: "テスト",
    amount: 110_000,
    account: "売掛金",
    confidence: 1,
    method: "match",
    needsReview: false,
    createdAt: "2026-04-20T00:00:00.000Z",
    updatedAt: "2026-04-20T00:00:00.000Z",
    ...patch,
  };
}

test("銀行明細に照合した入金は売掛金を消し込み、推定の入金仕訳は出さない", () => {
  const paid = invoice({
    status: "paid",
    updatedAt: "2026-05-02T00:00:00.000Z",
  });
  const journal = buildJournal([paid], [], new Map(), [
    bank({ matchedDocumentId: "d1", date: "2026-04-25" }),
  ]);
  const cash = journal.filter((e) =>
    e.lines.some((l) => l.account === "現金預金"),
  );
  assert.equal(cash.length, 1);
  assert.equal(cash[0].date, "2026-04-25");
  assert.equal(
    ledger(journal, "売掛金", { from: "2026-01-01", to: "2026-12-31" }).closing,
    0,
  );
});

test("請求額より少ない入金は、差額を支払手数料にして売掛金を全額消し込む", () => {
  const journal = buildJournal([invoice({})], [], new Map(), [
    bank({ matchedDocumentId: "d1", amount: 109_450 }),
  ]);
  const range = { from: "2026-01-01", to: "2026-12-31" };
  assert.equal(ledger(journal, "売掛金", range).closing, 0);
  assert.equal(ledger(journal, "支払手数料", range).closing, 550);
  assert.equal(ledger(journal, "現金預金", range).closing, 109_450);
});

test("銀行明細の対象期間内の引落は推定を出さず、期間外は推定を残す", () => {
  const exps = [
    expense({ id: "e1", date: "2026-04-15" }), // 引落 5/27（期間外）
    expense({ id: "e2", date: "2026-03-15", expectedDebitMonth: "2026-04" }), // 引落 4/27（期間内）
  ];
  const journal = buildJournal([], exps, new Map(), [
    bank({ id: "b9", date: "2026-04-01", amount: -1, account: "雑費" }),
    bank({ id: "b10", date: "2026-04-30", amount: -1, account: "雑費" }),
  ]);
  const settle = journal
    .filter((e) => e.source === "settlement")
    .map((e) => e.date);
  assert.deepEqual(settle, ["2026-05-27"]);
});

test("銀行明細の残高から期首残高（元入金）を作り、貸借が一致する", () => {
  const txs = [
    bank({
      id: "b1",
      date: "2026-04-01",
      seq: 0,
      amount: -50_000,
      balance: 450_000,
      account: "地代家賃",
    }),
    bank({
      id: "b2",
      date: "2026-04-02",
      seq: 1,
      amount: 20_000,
      balance: 470_000,
      account: "雑収入",
    }),
  ];
  const journal = buildJournal([], [], new Map(), txs);
  const bs = balanceSheet(journal, "2026-12-31", "2026-01-01");
  assert.equal(
    bs.assets.find((r) => r.account === "現金預金")?.amount,
    470_000,
  );
  assert.equal(bs.equity.find((r) => r.account === "元入金")?.amount, 500_000);
  assert.equal(
    bs.equity.find((r) => r.account === "当期純利益")?.amount,
    -30_000,
  );
  assert.ok(bs.balanced);
});
