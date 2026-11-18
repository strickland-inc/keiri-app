import assert from "node:assert/strict";
import test from "node:test";
import { buildCopyDraft, type DocumentRecord } from "./documents.ts";

const source: DocumentRecord = {
  id: "d1",
  type: "invoice",
  number: "INV-0007",
  issueDate: "2026-08-31",
  issuerId: "i1",
  partyId: "p1",
  title: "月額保守",
  items: [{ name: "保守", quantity: 1, unitPrice: 50_000, taxRate: 0.1 }],
  notes: "振込手数料は貴社負担",
  status: "paid",
  dueDate: "2026-09-30",
  createdAt: "2026-08-31T00:00:00.000Z",
  updatedAt: "2026-09-10T00:00:00.000Z",
  sheetUrl: "https://example.com/sheet",
  generatedSheetName: "INV-0007",
};

test("コピーは番号・ステータス・シートを引き継がず、内容は引き継ぐ", () => {
  const draft = buildCopyDraft(source, "2026-10-01");
  assert.equal(draft.number, "");
  assert.equal(draft.status, "draft");
  assert.equal(draft.sheetUrl, undefined);
  assert.equal(draft.generatedSheetName, undefined);
  assert.equal(draft.title, "月額保守");
  assert.equal(draft.notes, "振込手数料は貴社負担");
  assert.deepEqual(draft.items, source.items);
});

test("コピーの発行日は今日、支払期日は発行日からの日数を保つ", () => {
  const draft = buildCopyDraft(source, "2026-10-01");
  assert.equal(draft.issueDate, "2026-10-01");
  assert.equal(draft.dueDate, "2026-10-31");
});

test("コピーした明細を変更しても元の明細は変わらない", () => {
  const draft = buildCopyDraft(source, "2026-10-01");
  draft.items[0].unitPrice = 1;
  assert.equal(source.items[0].unitPrice, 50_000);
});
