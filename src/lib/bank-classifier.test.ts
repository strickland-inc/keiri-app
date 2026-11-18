import assert from "node:assert/strict";
import test from "node:test";
import type { BankTransaction, ParsedBankRow } from "../domain/bank.ts";
import type { DocumentRecord } from "../domain/documents.ts";
import { classifyRows, detectColumnsWithJev } from "./bank-classifier.ts";
import type { JevChoice } from "./jev.ts";

type Ask = (
  state: unknown,
  questions: Readonly<
    Record<
      string,
      { instructions: string; criteria: Readonly<Record<string, string>> }
    >
  >,
) => Promise<Record<string, JevChoice>>;

function row(key: string, amount: number, description: string): ParsedBankRow {
  return { key, date: "2026-09-10", seq: 0, description, amount };
}

function invoice(id: string, price: number): DocumentRecord {
  return {
    id,
    type: "invoice",
    number: `INV-${id}`,
    issueDate: "2026-08-31",
    issuerId: "i",
    partyId: "p1",
    title: "開発",
    items: [{ name: "x", quantity: 1, unitPrice: price, taxRate: 0.1 }],
    notes: "",
    status: "sent",
    createdAt: "",
    updatedAt: "",
  };
}

const ctx = (over: Partial<Parameters<typeof classifyRows>[1]> = {}) => ({
  existing: [] as BankTransaction[],
  invoices: [] as DocumentRecord[],
  partyNames: new Map([["p1", "株式会社サンプル商事"]]),
  ...over,
});

/** 出金の科目を決め打ちで返す Jev の代役。呼ばれた質問名を記録する。 */
function fakeAsk(answer: (name: string, criteria: string[]) => JevChoice): {
  ask: Ask;
  calls: string[];
} {
  const calls: string[] = [];
  const ask: Ask = async (_state, questions) => {
    const out: Record<string, JevChoice> = {};
    for (const [name, q] of Object.entries(questions)) {
      calls.push(name);
      out[name] = answer(name, Object.keys(q.criteria));
    }
    return out;
  };
  return { ask, calls };
}

test("金額が一致する請求書が 1 件なら Jev を使わずに照合する", async () => {
  const { ask, calls } = fakeAsk(() => {
    throw new Error("呼ばれないはず");
  });
  const result = await classifyRows(
    [row("a", 110_000, "サンプルショウジ")],
    ctx({ invoices: [invoice("d1", 100_000)] }),
    ask,
  );
  assert.equal(calls.length, 0);
  assert.equal(result.created[0].account, "売掛金");
  assert.equal(result.created[0].matchedDocumentId, "d1");
  assert.equal(result.created[0].needsReview, false);
  assert.deepEqual(result.matchedDocumentIds, ["d1"]);
});

test("同額の請求書が複数ある入金は Jev が選ぶ。同じ請求書を 2 回照合しない", async () => {
  const { ask } = fakeAsk((_n, criteria) => ({
    choice: criteria[0],
    confidence: 0.9,
  }));
  const invoices = [
    invoice("d1", 100_000),
    invoice("d2", 100_000),
    invoice("d3", 100_000),
  ];
  const result = await classifyRows(
    [row("a", 110_000, "A"), row("b", 110_000, "B")],
    ctx({ invoices }),
    ask,
  );
  const ids = result.created.flatMap((t) =>
    t.matchedDocumentId ? [t.matchedDocumentId] : [],
  );
  assert.equal(ids.length, 2);
  assert.equal(new Set(ids).size, 2, "同じ請求書を 2 回照合しない");
});

test("振込手数料を引かれた入金も、Jev が選べば照合する", async () => {
  const { ask } = fakeAsk((name, criteria) =>
    name === "invoice"
      ? { choice: criteria[0], confidence: 0.92 }
      : { choice: "雑収入", confidence: 0.9 },
  );
  const result = await classifyRows(
    [row("a", 109_450, "サンプルショウジ")],
    ctx({ invoices: [invoice("d1", 100_000)] }),
    ask,
  );
  assert.equal(result.created[0].matchedDocumentId, "d1");
});

test("照合できなかった入金は科目の判断に回り、売掛金は仮受金にして要確認にする", async () => {
  const { ask } = fakeAsk((name) =>
    name === "invoice"
      ? { choice: "none", confidence: 0.9 }
      : { choice: "売掛金", confidence: 0.95 },
  );
  const result = await classifyRows(
    [row("a", 109_450, "ナゾノニュウキン")],
    ctx({ invoices: [invoice("d1", 100_000)] }),
    ask,
  );
  assert.equal(result.created[0].account, "仮受金");
  assert.equal(result.created[0].needsReview, true);
  assert.equal(result.created[0].matchedDocumentId, undefined);
});

test("確信度が低い判断は要確認、高ければそのまま確定", async () => {
  const { ask } = fakeAsk(() => ({ choice: "地代家賃", confidence: 0.99 }));
  const high = await classifyRows([row("a", -80_000, "ヤチン")], ctx(), ask);
  assert.equal(high.created[0].account, "地代家賃");
  assert.equal(high.created[0].needsReview, false);
  assert.equal(high.created[0].method, "jev");

  const low = fakeAsk(() => ({ choice: "新聞図書費", confidence: 0.49 }));
  const r = await classifyRows([row("b", -80_000, "ヤチン")], ctx(), low.ask);
  assert.equal(r.created[0].needsReview, true);
});

test("Jev が失敗しても取り込みは止まらず、仮払金・仮受金に入れて要確認にする", async () => {
  const ask: Ask = async () => {
    throw new Error("down");
  };
  const result = await classifyRows(
    [row("a", -500, "X"), row("b", 500, "Y")],
    ctx(),
    ask,
  );
  assert.deepEqual(
    result.created.map((t) => [t.account, t.needsReview, t.method]),
    [
      ["仮払金", true, "fallback"],
      ["仮受金", true, "fallback"],
    ],
  );
});

test("Jev が選択肢にない科目を返したら仮払金にする", async () => {
  const { ask } = fakeAsk(() => ({ choice: "存在しない科目", confidence: 1 }));
  const result = await classifyRows([row("a", -500, "X")], ctx(), ask);
  assert.equal(result.created[0].account, "仮払金");
});

test("取り込み済みの行は重複として除き、確認済みの摘要は科目を再利用して Jev を呼ばない", async () => {
  const { ask, calls } = fakeAsk(() => {
    throw new Error("呼ばれないはず");
  });
  const existing: BankTransaction[] = [
    {
      id: "t1",
      key: "dup",
      date: "2026-08-10",
      seq: 0,
      description: "ヤチン 2026年8月分",
      amount: -80_000,
      account: "地代家賃",
      confidence: 0.99,
      method: "jev",
      needsReview: false,
      createdAt: "",
      updatedAt: "",
    },
  ];
  const result = await classifyRows(
    [
      row("dup", -80_000, "ヤチン 2026年8月分"),
      row("new", -80_000, "ヤチン 2026年9月分"),
    ],
    ctx({ existing }),
    ask,
  );
  assert.equal(result.duplicates, 1);
  assert.equal(result.created.length, 1);
  assert.equal(result.created[0].account, "地代家賃");
  assert.equal(result.created[0].method, "rule");
  assert.equal(calls.length, 0);
});

test("見出しで列を決められない CSV は Jev が列の役割を答える", async () => {
  const rows = [
    ["A", "B", "C", "D"],
    ["2026/9/1", "ヤチン", "80000", "420000"],
    ["2026/9/2", "ニュウキン", "10000", "430000"],
  ];
  const roles = ["date", "description", "amount", "balance"];
  const { ask } = fakeAsk((name) => ({
    choice: roles[Number(name.replace("列", ""))],
    confidence: 0.9,
  }));
  const mapping = await detectColumnsWithJev(rows, ask);
  assert.deepEqual(mapping, { headerRow: 0, roles });
  const none = await detectColumnsWithJev(rows, async () => ({}));
  assert.equal(none, null);
});
