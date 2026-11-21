import assert from "node:assert/strict";
import test from "node:test";
import { expenseDedupKey, parseExpenseCsv } from "./expense-csv.ts";

const utf8 = (text: string) => new TextEncoder().encode(text);

// 「利用日,利用店名・商品名,…」の楽天カード形式を Shift_JIS にしたもの（iconv で作成）
const RAKUTEN_SJIS_HEX =
  "9798977093fa2c97989770935896bc81458fa4956996bc2c979897708ed22c8e7895a595fb96402c979897708be08a7a2c8e7895a58ee8909497bf2c8e7895a5918d8a7a0a323032352f30312f30352c8365835883678f9193582c967b906c2c3189f195a582a22c22312c323030222c302c22312c323030220a";

const RAKUTEN_CSV = [
  "利用日,利用店名・商品名,利用者,支払方法,利用金額,支払手数料,支払総額",
  '2025/01/05,テスト書店,本人,1回払い,"1,200",0,"1,200"',
  '2025/01/06,ﾃｽﾄ食堂,本人,1回払い,"3,400",0,"3,400"',
  '2025/01/07,テスト返金,本人,1回払い,"-500",0,"-500"',
  "不明,テスト不明,本人,1回払い,100,0,100",
].join("\n");

test("楽天カード: 列を読み、返金と日付不明の行は skipped に数える", () => {
  const result = parseExpenseCsv(utf8(RAKUTEN_CSV));
  assert.equal(result.format, "rakuten");
  assert.deepEqual(result.rows, [
    { date: "2025-01-05", merchant: "テスト書店", amount: 1200 },
    { date: "2025-01-06", merchant: "ﾃｽﾄ食堂", amount: 3400 },
  ]);
  assert.equal(result.skipped, 2);
});

test("楽天カード: Shift_JIS を読める", () => {
  const result = parseExpenseCsv(
    new Uint8Array(Buffer.from(RAKUTEN_SJIS_HEX, "hex")),
  );
  assert.equal(result.format, "rakuten");
  assert.deepEqual(result.rows, [
    { date: "2025-01-05", merchant: "テスト書店", amount: 1200 },
  ]);
});

test("UTF-8 は BOM があってもなくても読める", () => {
  const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8(RAKUTEN_CSV)]);
  assert.deepEqual(
    parseExpenseCsv(withBom).rows,
    parseExpenseCsv(utf8(RAKUTEN_CSV)).rows,
  );
  assert.equal(parseExpenseCsv(withBom).rows.length, 2);
});

const PAYPAY_CSV = [
  "取引日,出金金額（円）,入金金額（円）,海外出金金額,通貨,変換レート（円）,利用国,取引内容,取引先,取引方法,支払い区分,利用者,取引番号",
  '2025/02/01 10:15:00,"1,500",-,-,-,-,JP,支払い,テストマート,PayPay残高,-,本人,0001',
  "2025/02/02 11:00:00,-,5000,-,-,-,JP,チャージ,-,銀行,-,本人,0002",
  "2025/02/03 12:00:00,800,-,-,-,-,JP,送金,,PayPay残高,-,本人,0003",
].join("\n");

test("PayPay: 出金だけ読み、取引先が空なら取引内容を利用先にする", () => {
  const result = parseExpenseCsv(utf8(PAYPAY_CSV));
  assert.equal(result.format, "paypay");
  assert.deepEqual(result.rows, [
    { date: "2025-02-01", merchant: "テストマート", amount: 1500 },
    { date: "2025-02-03", merchant: "送金", amount: 800 },
  ]);
  assert.equal(result.skipped, 1);
});

test("そのほかの形式: 見出しから日付・利用先・金額の列を推定する", () => {
  const csv = [
    "カード明細 2025年3月分",
    "ご利用日,ご利用内容,備考,ご請求金額",
    '2025年3月1日,テスト喫茶,,"2,100"',
    "2025-03-02,テスト通信,,9800",
  ].join("\n");
  const result = parseExpenseCsv(utf8(csv));
  assert.equal(result.format, "generic");
  assert.deepEqual(result.rows, [
    { date: "2025-03-01", merchant: "テスト喫茶", amount: 2100 },
    { date: "2025-03-02", merchant: "テスト通信", amount: 9800 },
  ]);
  assert.equal(result.skipped, 0);
});

test("重複キーは 日付|利用先|金額", () => {
  assert.equal(
    expenseDedupKey({
      date: "2025-01-05",
      merchant: "テスト書店",
      amount: 1200,
    }),
    "2025-01-05|テスト書店|1200",
  );
});

test("列を推定できない CSV は分かりやすい日本語で例外を投げる", () => {
  assert.throws(
    () => parseExpenseCsv(utf8("名前,年齢\nテスト太郎,30\n")),
    /日付・利用先・金額の列を見つけられませんでした/,
  );
  assert.throws(() => parseExpenseCsv(utf8("")), /列を見つけられませんでした/);
});
