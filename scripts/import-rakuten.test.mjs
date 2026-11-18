import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRakutenStatementPdf } from "./import-rakuten.mjs";

const HEADER = [
  "ご利用代金請求明細書",
  "山田      太郎 様                                                                                                        2026/09/01",
  " 2025年11月ご請求金額                     ご利用カード                                               ※ご利用いただけない場合は、092‑303‑7188",
  " 123,456円                           楽天カード（Visa） ****‑****‑****‑0000",
  "",
  "   お支払日                    返済方法    引落口座          請求確定日         利用獲得ポイント           調整額                返金額",
  "",
  "  2025/11/27               口座振替    〇〇銀行             2025/11/20       1,234ポイント                 0円               0円",
  "                                        △△支店",
  "                                    普通 ***0000",
  "",
  "",
  " ご利用明細                                                                                                              （単位：円）",
  "",
  "  利用日          利用店名                利用者      支払方法              利用金額      手数料/利息      支払総額             当月請求額          翌月繰越残高",
].join("\n");

test("明細行を1件パースできる", () => {
  const text = [
    HEADER,
    "2025/10/31   JRﾋｶﾞｼﾆﾎﾝ ﾐﾄﾞ ﾘﾉﾏﾄﾞ   本人*       1回払い               7,660         0          7,660              7,660           0",
    "",
  ].join("\n");
  const items = parseRakutenStatementPdf(text);
  assert.deepEqual(items, [
    { date: "2025-10-31", merchant: "JRﾋｶﾞｼﾆﾎﾝ ﾐﾄﾞ ﾘﾉﾏﾄﾞ", amount: 7660 },
  ]);
});

test("割引行は直前の明細に加算し、0円以下になったら落とす（U+2011のマイナス）", () => {
  const text = [
    HEADER,
    "2025/11/04   ＥＴＣカード年会費／２６年１０月迄     本人*       1回払い                 550         0                  0              0           0",
    "",
    "             割引                                                  ‑550",
    "",
  ].join("\n");
  const items = parseRakutenStatementPdf(text);
  assert.deepEqual(items, []);
});

test("割引が明細額より小さければ差額を残す（通常のハイフンのマイナスにも対応）", () => {
  const text = [
    HEADER,
    "2025/11/04   ＥＴＣカード年会費／２６年１０月迄     本人*       1回払い                 550         0                  0              0           0",
    "",
    "             割引                                                  -300",
    "",
  ].join("\n");
  const items = parseRakutenStatementPdf(text);
  assert.deepEqual(items, [
    {
      date: "2025-11-04",
      merchant: "ＥＴＣカード年会費／２６年１０月迄",
      amount: 250,
    },
  ]);
});

test("現地利用額・換レートの継続行は無視する", () => {
  const text = [
    HEADER,
    "2025/10/20   SUPABASE利用国SG                        本人*   1回払い     3,904        0     3,904     3,904        0",
    "",
    "             現地利用額         ２５．０００変",
    "             換レート １５６．１６０円",
    "",
    "2025/10/18   X CORP. PAID FEATURE利用国US            本人*   1回払い       918        0       918       918        0",
    "",
  ].join("\n");
  const items = parseRakutenStatementPdf(text);
  assert.deepEqual(items, [
    { date: "2025-10-20", merchant: "SUPABASE利用国SG", amount: 3904 },
    {
      date: "2025-10-18",
      merchant: "X CORP. PAID FEATURE利用国US",
      amount: 918,
    },
  ]);
});

test("お支払日などヘッダー部の日付行（本人を含まない）は明細として拾わない", () => {
  const items = parseRakutenStatementPdf(HEADER);
  assert.deepEqual(items, []);
});

test("分割払い1回目（本人*）は取り込む", () => {
  const text = [
    HEADER,
    "2025/10/14   ｱｺﾞﾀﾞ                                本人*   分割3回払い(1回目)    14,512       296    14,808      4,936      9,872",
    "",
  ].join("\n");
  const items = parseRakutenStatementPdf(text);
  assert.deepEqual(items, [
    { date: "2025-10-14", merchant: "ｱｺﾞﾀﾞ", amount: 14512 },
  ]);
});

test("分割払い2回目以降（本人にアスタリスクなし）は初回の月に取込済みなので落とす", () => {
  const text = [
    HEADER,
    "2025/10/14   ｱｺﾞﾀﾞ                            本人    分割3回払い(2回目)     14,512        296    14,808      4,936      4,936",
    "2025/10/08   ｱｺﾞﾀﾞ                            本人    分割12回払い(3回目)    37,162      3,032    40,194      3,349     33,490",
    "",
  ].join("\n");
  const items = parseRakutenStatementPdf(text);
  assert.deepEqual(items, []);
});

test("リボ払いの継続分（本人にアスタリスクなし）は初回の月に取込済みなので落とす", () => {
  const text = [
    HEADER,
    "2025/10/14   ｵﾝﾗｲﾝｼﾖｯﾌﾟ                       本人    リボ払い          5,000        50    5,050      3,000      2,050",
    "",
  ].join("\n");
  const items = parseRakutenStatementPdf(text);
  assert.deepEqual(items, []);
});

test("リボ払いの初回（本人*）は取り込む", () => {
  const text = [
    HEADER,
    "2025/10/14   ｵﾝﾗｲﾝｼﾖｯﾌﾟ                       本人*   リボ払い          5,000        50    5,050      3,000      2,050",
    "",
  ].join("\n");
  const items = parseRakutenStatementPdf(text);
  assert.deepEqual(items, [
    { date: "2025-10-14", merchant: "ｵﾝﾗｲﾝｼﾖｯﾌﾟ", amount: 5000 },
  ]);
});

test("店名内の連続空白は1つにまとめる", () => {
  const text = [
    HEADER,
    "2025/10/04   楽天ＳＰ         Ｓａｒｄｉｎａ             本人*      1回払い           5,060          0      5,060      5,060          0",
    "",
  ].join("\n");
  const items = parseRakutenStatementPdf(text);
  assert.deepEqual(items, [
    { date: "2025-10-04", merchant: "楽天ＳＰ Ｓａｒｄｉｎａ", amount: 5060 },
  ]);
});

test("同じ日付・店名・金額の取引が複数あっても、どちらも別取引として残す", () => {
  const text = [
    HEADER,
    "2025/10/03   ﾌｱﾐﾘｰﾏｰﾄ                         本人*   1回払い       480        0       480        480        0",
    "",
    "2025/10/03   ﾌｱﾐﾘｰﾏｰﾄ                         本人*   1回払い       480        0       480        480        0",
    "",
  ].join("\n");
  const items = parseRakutenStatementPdf(text);
  assert.equal(items.length, 2);
  assert.deepEqual(items[0], items[1]);
});

test("ページまたぎで再掲されるヘッダー・注記行・リボのお支払予定は無視する", () => {
  const text = [
    HEADER,
    "2025/10/02   GOOGLE PLAY JAPAN                本人*      1回払い           2,280          0      2,280      2,280          0",
    " ご利用明細",
    "                                                                                      （単位：円）",
    "  利用日          利用店名                利用者   支払方法   利用金額      手数料/利息   支払総額      当月請求額      翌月繰越残高",
    "2025/10/02   ｾｲﾕｳ                本人*   1回払い       587        0       587        587        0",
    " リボのお支払予定",
    "              前月繰越残高 新規利用分        調整額       残高合計       元金       手数料/利息   当月請求額     翌月繰越残高",
    "ショッピング              0        0          0          0        0        0         0        0",
    "",
  ].join("\n");
  const items = parseRakutenStatementPdf(text);
  assert.deepEqual(items, [
    { date: "2025-10-02", merchant: "GOOGLE PLAY JAPAN", amount: 2280 },
    { date: "2025-10-02", merchant: "ｾｲﾕｳ", amount: 587 },
  ]);
});
