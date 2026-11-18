import { test } from "node:test";
import assert from "node:assert/strict";
import { counterKey, matchesCompany, nextSequence } from "./scope.ts";

test("スコープ未指定なら全件通す", () => {
  assert.equal(matchesCompany("issuer-a", {}), true);
  assert.equal(matchesCompany(undefined, {}), true);
});

test("会社が一致するレコードだけ通す", () => {
  assert.equal(matchesCompany("issuer-a", { issuerId: "issuer-a" }), true);
  assert.equal(matchesCompany("issuer-b", { issuerId: "issuer-a" }), false);
});

test("会社未設定の既存データは、既定会社を見ているときだけ通す", () => {
  assert.equal(
    matchesCompany(undefined, {
      issuerId: "issuer-a",
      includeUnassigned: true,
    }),
    true,
  );
  assert.equal(
    matchesCompany(undefined, { issuerId: "issuer-a" }),
    false,
    "既定会社以外に、会社未設定のデータが紛れ込んではいけない",
  );
});

test("採番キーは会社ごと・帳票種別ごとに分かれる", () => {
  assert.equal(counterKey("issuer-a", "invoice"), "issuer-a:invoice");
  assert.notEqual(
    counterKey("issuer-a", "invoice"),
    counterKey("issuer-b", "invoice"),
  );
  assert.notEqual(
    counterKey("issuer-a", "invoice"),
    counterKey("issuer-a", "quote"),
  );
});

test("新しい会社の連番は 1 から始まる", () => {
  assert.equal(nextSequence(0, 0), 1);
});

test("カウンターが無くても、発行済みの最大番号の次から振る", () => {
  // 会社ごとのカウンターを後から導入したため、既存の会社では行が無い状態で始まる。
  assert.equal(nextSequence(0, 2), 3);
});

test("カウンターが実データより遅れていても番号を重複させない", () => {
  assert.equal(nextSequence(1, 7), 8);
});

test("発行済みが無くてもカウンターを尊重する", () => {
  // 発行した帳票を削除した後でも、消した番号を再利用しない。
  assert.equal(nextSequence(5, 0), 6);
});
