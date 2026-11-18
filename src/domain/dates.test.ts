import assert from "node:assert/strict";
import test from "node:test";
import { recentMonths, toIsoDate, toYearMonth } from "./dates.ts";

test("ローカル時刻のまま YYYY-MM-DD と YYYY-MM にする", () => {
  const d = new Date(2026, 0, 5, 0, 30);
  assert.equal(toIsoDate(d), "2026-01-05");
  assert.equal(toYearMonth(d), "2026-01");
});

test("基準月で終わる月の一覧を古い順に返し、年をまたげる", () => {
  assert.deepEqual(recentMonths(3, new Date(2026, 1, 28)), [
    "2025-12",
    "2026-01",
    "2026-02",
  ]);
});
