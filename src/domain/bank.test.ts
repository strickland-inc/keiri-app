import assert from "node:assert/strict";
import test from "node:test";
import type { DocumentRecord } from "./documents.ts";
import {
  decodeText,
  descriptionKey,
  detectColumns,
  extractRows,
  findInvoiceCandidates,
  parseAmount,
  parseCsv,
  parseDate,
  roleOfHeader,
} from "./bank.ts";

function load(csv: string) {
  const rows = parseCsv(csv);
  const mapping = detectColumns(rows);
  assert.ok(mapping, "列を判定できなかった");
  return extractRows(rows, mapping);
}

test("CSV: 引用符・改行入りセル・CRLF・タブ区切りを読める", () => {
  assert.deepEqual(parseCsv('a,"b,1","c ""q"""\r\nd,e,f\r\n'), [
    ["a", "b,1", 'c "q"'],
    ["d", "e", "f"],
  ]);
  assert.deepEqual(parseCsv("a\tb\n1\t2"), [
    ["a", "b"],
    ["1", "2"],
  ]);
});

test("文字コード: UTF-8 と Shift_JIS を自動で見分ける", () => {
  assert.equal(decodeText(new TextEncoder().encode("摘要")), "摘要");
  // 「日付」の Shift_JIS
  assert.equal(decodeText(new Uint8Array([0x93, 0xfa, 0x95, 0x74])), "日付");
  assert.equal(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, 0x61])), "a");
});

test("日付: 西暦・和暦・8桁・日本語表記", () => {
  assert.equal(parseDate("2026/9/5"), "2026-09-05");
  assert.equal(parseDate("2026-09-05"), "2026-09-05");
  assert.equal(parseDate("2026年9月5日"), "2026-09-05");
  assert.equal(parseDate("20260905"), "2026-09-05");
  assert.equal(parseDate("R8.9.5"), "2026-09-05");
  assert.equal(parseDate("令和元年5月1日"), "2019-05-01");
  assert.equal(parseDate("摘要"), null);
  assert.equal(parseDate("2026/13/01"), null);
});

test("金額: カンマ・円・▲・括弧・全角", () => {
  assert.equal(parseAmount("1,234"), 1234);
  assert.equal(parseAmount("¥12,000円"), 12000);
  assert.equal(parseAmount("▲5,000"), -5000);
  assert.equal(parseAmount("(300)"), -300);
  assert.equal(parseAmount("-800"), -800);
  assert.equal(parseAmount("１，５００"), 1500);
  assert.equal(parseAmount(""), null);
  assert.equal(parseAmount("摘要"), null);
});

test("見出し: 銀行ごとの呼び名の違いを役割に直す", () => {
  assert.equal(roleOfHeader("お預入れ金額"), "deposit");
  assert.equal(roleOfHeader("お引出し金額"), "withdrawal");
  assert.equal(roleOfHeader("入出金(円)"), "amount");
  assert.equal(roleOfHeader("取引後残高"), "balance");
  assert.equal(roleOfHeader("入出金区分"), "direction");
  assert.equal(roleOfHeader("お取り扱い内容"), "description");
  assert.equal(roleOfHeader("勘定日"), "date");
});

test("入金・出金が別の列（新しい順）: 古い順に直し、符号を付ける", () => {
  const { rows, skipped } = load(
    [
      "ご利用明細,,,,",
      "日付,摘要,出金金額,入金金額,残高",
      '2026/09/10,ﾗｸﾃﾝｶｰﾄﾞ,"55,000",,"445,000"',
      '2026/09/01,ｶ)ｻﾝﾌﾟﾙ ﾆｭｳｷﾝ,,"100,000","500,000"',
    ].join("\n"),
  );
  assert.equal(skipped, 0);
  assert.deepEqual(
    rows.map((r) => [r.date, r.amount, r.balance, r.description]),
    [
      ["2026-09-01", 100_000, 500_000, "カ)サンプル ニュウキン"],
      ["2026-09-10", -55_000, 445_000, "ラクテンカード"],
    ],
  );
});

test("金額 + 入出金区分の列", () => {
  const { rows } = load(
    [
      "取引日,取引内容,金額,入出金区分",
      "20260901,振込,3300,入金",
      "20260902,手数料,330,出金",
    ].join("\n"),
  );
  assert.deepEqual(
    rows.map((r) => r.amount),
    [3300, -330],
  );
});

test("符号付き金額の列（▲）", () => {
  const { rows } = load(
    ["年月日,内容,金額", "2026/9/1,A,▲1000", "2026/9/2,B,2000"].join("\n"),
  );
  assert.deepEqual(
    rows.map((r) => r.amount),
    [-1000, 2000],
  );
});

test("区分が無い金額 + 残高: 残高の増減から入出金を決める", () => {
  const { rows, skipped } = load(
    [
      "日付,摘要,金額,残高",
      "2026/9/1,繰越,100,1000",
      "2026/9/2,A,300,700",
      "2026/9/3,B,50,750",
    ].join("\n"),
  );
  // 先頭行は決められないので除外、以降は増減から決まる
  assert.equal(skipped, 1);
  assert.deepEqual(
    rows.map((r) => r.amount),
    [-300, 50],
  );
});

test("見出しの無い CSV は値の形から列を決める", () => {
  const { rows } = load(
    [
      '2026/9/1,ﾔﾁﾝ,"80,000",,"420,000"',
      '2026/9/5,ﾆｭｳｷﾝ,,"10,000","430,000"',
    ].join("\n"),
  );
  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map((r) => r.amount),
    [-80_000, 10_000],
  );
});

test("同じ行が 2 回あっても別の取引として残り、再取り込みでキーが一致する", () => {
  const csv = [
    "日付,摘要,出金,入金",
    "2026/9/1,A,100,",
    "2026/9/1,A,100,",
  ].join("\n");
  const first = load(csv).rows.map((r) => r.key);
  assert.equal(new Set(first).size, 2);
  assert.deepEqual(
    load(csv).rows.map((r) => r.key),
    first,
  );
});

test("列を判定できない CSV は null", () => {
  assert.equal(detectColumns(parseCsv("あ,い\nう,え")), null);
});

test("摘要キーは数字・日付を除いて同一視する", () => {
  assert.equal(
    descriptionKey("ヤチン 2026年9月分 123"),
    descriptionKey("ヤチン 2026年10月分 456"),
  );
});

function inv(
  id: string,
  price: number,
  issueDate = "2026-08-31",
): DocumentRecord {
  return {
    id,
    type: "invoice",
    number: id,
    issueDate,
    issuerId: "i",
    partyId: "p",
    title: "t",
    items: [{ name: "x", quantity: 1, unitPrice: price, taxRate: 0.1 }],
    notes: "",
    status: "sent",
    createdAt: "",
    updatedAt: "",
  };
}

test("請求書の照合: 金額一致と、振込手数料を引いた額の候補", () => {
  const docs = [
    inv("a", 100_000),
    inv("b", 50_000),
    inv("c", 100_000, "2026-07-31"),
  ];
  const hit = findInvoiceCandidates(110_000, docs);
  assert.deepEqual(
    hit.exact.map((c) => c.doc.id),
    ["c", "a"],
  );
  const near = findInvoiceCandidates(109_450, docs);
  assert.equal(near.exact.length, 0);
  assert.deepEqual(
    near.nearWithFee.map((c) => c.doc.id),
    ["c", "a"],
  );
  assert.equal(findInvoiceCandidates(-110_000, docs).exact.length, 0);
  assert.equal(
    findInvoiceCandidates(50_000, [inv("d", 100_000)]).nearWithFee.length,
    0,
  );
});
