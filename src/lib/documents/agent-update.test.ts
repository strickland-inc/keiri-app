import assert from "node:assert/strict";
import test from "node:test";
import { canVoid, parseIssuerPatch } from "./agent-update.ts";

test("振込先の改行を LF にそろえ、前後の空白を除く", () => {
  const r = parseIssuerPatch({
    bankInfo: " 銀行 支店\r\n普通 1234567\r\nメイギ\n",
  });
  assert.ok(!(r instanceof Error));
  assert.equal(r.bankInfo, "銀行 支店\n普通 1234567\nメイギ");
});

test("更新できない項目（名称・既定など）は拒否する", () => {
  for (const body of [
    { name: "x" },
    { isDefault: true },
    { bankInfo: "a", sealImageUrl: "u" },
  ]) {
    assert.ok(parseIssuerPatch(body) instanceof Error);
  }
});

test("空のオブジェクト・文字列以外・長すぎる値は拒否する", () => {
  assert.ok(parseIssuerPatch({}) instanceof Error);
  assert.ok(parseIssuerPatch([]) instanceof Error);
  assert.ok(parseIssuerPatch({ address: 1 }) instanceof Error);
  assert.ok(parseIssuerPatch({ bankInfo: "あ".repeat(501) }) instanceof Error);
});

test("空文字は、その項目を空にする指定として受け付ける", () => {
  assert.deepEqual(parseIssuerPatch({ phone: "" }), { phone: "" });
});

test("無効にできるのは下書き・発行済み・送付済みだけ", () => {
  assert.equal(canVoid("draft"), true);
  assert.equal(canVoid("issued"), true);
  assert.equal(canVoid("sent"), true);
  assert.equal(canVoid("paid"), false);
  assert.equal(canVoid("void"), false);
});
