import assert from "node:assert/strict";
import test from "node:test";
import { parseAgentDocumentRequest } from "./agent-request.ts";

const parties = [
  { id: "p1", name: "株式会社サンプル商事", createdAt: "", updatedAt: "" },
];
const issuers = [
  { id: "i1", name: "A" },
  { id: "i2", name: "B", isDefault: true },
];
const base = {
  type: "invoice",
  partyName: "株式会社サンプル商事",
  title: "案件",
  issueDate: "2026-09-30",
  dueDate: "2026-10-31",
  items: [{ name: "業務委託", quantity: 1, unitPrice: 250000, taxRate: 0.1 }],
};
// 型の細部はテストの関心外
const ctx = { parties, issuers, existing: [] } as never;

test("取引先を名前で解決し、発行元は既定を使う", () => {
  const r = parseAgentDocumentRequest({ documents: [base] }, ctx);
  assert.ok(!(r instanceof Error));
  const first = (
    r as Array<{ ok: boolean; input?: { partyId: string; issuerId: string } }>
  )[0];
  assert.equal(first.ok, true);
  assert.equal(first.input?.partyId, "p1");
  assert.equal(first.input?.issuerId, "i2");
});

test("税込の端数が出る単価（小数）は拒否する", () => {
  const r = parseAgentDocumentRequest(
    { documents: [{ ...base, items: [{ name: "x", unitPrice: 192556.36 }] }] },
    ctx,
  ) as Array<{ ok: boolean; error?: string }>;
  assert.equal(r[0].ok, false);
});

test("存在しない取引先・不正な日付は書類ごとに失敗する", () => {
  const r = parseAgentDocumentRequest(
    {
      documents: [
        { ...base, partyName: "ない" },
        { ...base, issueDate: "9/30" },
      ],
    },
    ctx,
  ) as Array<{ ok: boolean }>;
  assert.deepEqual(
    r.map((x) => x.ok),
    [false, false],
  );
});

test("同じ書類が既にあれば duplicateOf を返す", () => {
  const existing = [
    {
      id: "d1",
      issuerId: "i2",
      type: "invoice",
      partyId: "p1",
      issueDate: "2026-09-30",
      title: "案件",
      status: "issued",
    },
  ];
  const r = parseAgentDocumentRequest({ documents: [base] }, {
    parties,
    issuers,
    existing,
  } as never) as Array<{
    duplicateOf?: string;
  }>;
  assert.equal(r[0].duplicateOf, "d1");
});

test("別の会社の同じ内容の書類は重複として扱わない", () => {
  const existing = [
    {
      id: "d1",
      issuerId: "i1",
      type: "invoice",
      partyId: "p1",
      issueDate: "2026-09-30",
      title: "案件",
      status: "issued",
    },
  ];
  const r = parseAgentDocumentRequest({ documents: [base] }, {
    parties,
    issuers,
    existing,
  } as never) as Array<{
    ok: boolean;
    duplicateOf?: string;
  }>;
  assert.equal(r[0].ok, true);
  assert.equal(r[0].duplicateOf, undefined);
});

test("件数の上限と空配列を拒否する", () => {
  assert.ok(parseAgentDocumentRequest({ documents: [] }, ctx) instanceof Error);
  assert.ok(
    parseAgentDocumentRequest(
      { documents: Array(6).fill(base) },
      ctx,
    ) instanceof Error,
  );
});
