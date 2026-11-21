import assert from "node:assert/strict";
import test from "node:test";
import { isIsoDate, isYen, LIMITS } from "./limits.ts";

test("isIsoDate は、存在する YYYY-MM-DD だけを通す", () => {
  assert.equal(isIsoDate("2026-11-21"), true);
  assert.equal(isIsoDate("2028-02-29"), true);
  assert.equal(isIsoDate("2026-02-30"), false);
  assert.equal(isIsoDate("2026-13-01"), false);
  assert.equal(isIsoDate("2026/11/21"), false);
  assert.equal(isIsoDate("=1+1"), false);
  assert.equal(isIsoDate(""), false);
});

test("isYen は、上限までの整数だけを通す", () => {
  assert.equal(isYen(0), true);
  assert.equal(isYen(-5000), true);
  assert.equal(isYen(LIMITS.amount), true);
  assert.equal(isYen(LIMITS.amount + 1), false);
  assert.equal(isYen(12.5), false);
  assert.equal(isYen(Number.NaN), false);
});
