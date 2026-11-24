import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  passwordIterations,
  validateDisplayName,
  validateLoginId,
  validatePassword,
} from "./password-policy.ts";

const env = process.env as Record<string, string | undefined>;
const original = env.KEIRI_PASSWORD_ITERATIONS;

afterEach(() => {
  if (original === undefined) delete env.KEIRI_PASSWORD_ITERATIONS;
  else env.KEIRI_PASSWORD_ITERATIONS = original;
});

test("12 文字以上 200 文字以内、ID と同じ文字列と、よくある弱いパスワードは不可", () => {
  assert.match(validatePassword("short", "taro") ?? "", /12 文字以上/);
  assert.match(validatePassword("a".repeat(201), "taro") ?? "", /200 文字以内/);
  assert.match(
    validatePassword("taro-yamada-001", "Taro-Yamada-001") ?? "",
    /ログイン ID/,
  );
  assert.match(validatePassword("Password1234", "taro") ?? "", /よく使われる/);
  assert.match(validatePassword("aaaaaaaaaaaa", "taro") ?? "", /よく使われる/);
  assert.equal(validatePassword("horse-battery-staple", "taro"), null);
  assert.equal(validatePassword("あいうえおかきくけこさし", "taro"), null);
  assert.equal(validatePassword("a".repeat(11) + "あ", "taro"), null);
  assert.equal(validatePassword("x".repeat(199) + "y", "taro"), null);
});

test("反復回数の環境変数は 20,000〜100,000 の整数だけ受け付ける", () => {
  delete env.KEIRI_PASSWORD_ITERATIONS;
  assert.equal(passwordIterations(), 20_000);
  for (const [value, expected] of [
    ["20000", 20_000],
    ["50000", 50_000],
    ["100000", 100_000],
    ["19999", 20_000],
    ["100001", 20_000],
    ["600000", 20_000],
    ["abc", 20_000],
    ["50000.5", 20_000],
    ["-50000", 20_000],
    ["", 20_000],
  ] as const) {
    env.KEIRI_PASSWORD_ITERATIONS = value;
    assert.equal(passwordIterations(), expected, value);
  }
});

test("ログイン ID と表示名の規則", () => {
  assert.equal(validateLoginId("taro.yamada@example.com"), null);
  assert.equal(validateLoginId("a_b-c"), null);
  assert.notEqual(validateLoginId("ab"), null);
  assert.notEqual(validateLoginId("太郎さん"), null);
  assert.notEqual(validateLoginId("a b c"), null);
  assert.notEqual(validateLoginId("a".repeat(65)), null);
  assert.equal(validateDisplayName("山田 太郎"), null);
  assert.notEqual(validateDisplayName("   "), null);
  assert.notEqual(validateDisplayName("あ".repeat(51)), null);
});
