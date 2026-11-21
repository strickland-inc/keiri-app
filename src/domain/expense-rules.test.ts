import assert from "node:assert/strict";
import test from "node:test";
import { EXPENSE_CATEGORIES } from "./expense.ts";
import {
  EXPENSE_RULES,
  HIGH_AMOUNT_THRESHOLD,
  classifyExpense,
} from "./expense-rules.ts";

const none = new Map();

function category(merchant: string, amount = 1000) {
  return classifyExpense({ merchant, amount }, none);
}

test("辞書: 代表的な店名が費目に当たる", () => {
  const cases: Array<[string, string]> = [
    ["JR東日本", "旅費交通費"],
    ["ﾀｸｼｰ GO", "旅費交通費"],
    ["ENEOS 渋谷SS", "車両費"],
    ["ETC利用", "車両費"],
    ["AMAZON WEB SERVICES", "通信費"],
    ["GITHUB INC", "通信費"],
    ["ANTHROPIC", "通信費"],
    ["GOOGLE ADS", "広告宣伝費"],
    ["ヤマト運輸", "荷造運賃"],
    ["ﾗﾝｻｰｽﾞ", "外注費"],
    ["丸善 丸の内本店", "新聞図書費"],
    ["UDEMY", "研修費"],
    ["STRIPE", "支払手数料"],
    ["ASKUL", "消耗品費"],
    ["東京電力", "水道光熱費"],
    ["ｽﾀｰﾊﾞｯｸｽ", "会議費"],
    ["あいおいニッセイ損保", "保険料"],
    ["日本商工会議所 年会費", "諸会費"],
  ];
  for (const [merchant, expected] of cases) {
    const result = category(merchant);
    assert.equal(result.category, expected, merchant);
    assert.equal(result.method, "rule", merchant);
  }
});

test("辞書: 先に書いたルールが優先される（ｴﾈｵｽでんきは車両費）", () => {
  assert.equal(category("ｴﾈｵｽでんき").category, "車両費");
});

test("辞書の全ての費目は EXPENSE_CATEGORIES にある", () => {
  for (const [, c] of EXPENSE_RULES) {
    assert.ok((EXPENSE_CATEGORIES as readonly string[]).includes(c), c);
  }
});

test("学習辞書がルール辞書より優先される", () => {
  const learned = new Map([["ASKUL", "雑費" as const]]);
  assert.deepEqual(
    classifyExpense({ merchant: "ASKUL 123", amount: 500 }, learned),
    { category: "雑費", method: "learned" },
  );
});

test("学習辞書のキーは正規化した利用先（末尾の数字・全角空白を落とす）", () => {
  const learned = new Map([["謎の店", "会議費" as const]]);
  assert.equal(
    classifyExpense({ merchant: "謎の店　0123", amount: 800 }, learned).method,
    "learned",
  );
});

test("金額: ルールに当たらない10万円以上は要確認（amount）", () => {
  assert.deepEqual(category("謎の商会", HIGH_AMOUNT_THRESHOLD), {
    category: "要確認",
    method: "amount",
  });
  assert.equal(
    category("謎の商会", HIGH_AMOUNT_THRESHOLD - 1).method,
    "unknown",
  );
});

test("金額: ルールに当たれば10万円以上でもルールの費目のまま", () => {
  assert.deepEqual(category("ﾖﾄﾞﾊﾞｼｶﾒﾗ", 250_000), {
    category: "消耗品費",
    method: "rule",
  });
});

test("どれにも当たらない店名は要確認（unknown）", () => {
  assert.deepEqual(category("ZZZ商店"), {
    category: "要確認",
    method: "unknown",
  });
});
