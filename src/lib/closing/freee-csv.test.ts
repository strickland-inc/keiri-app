import assert from "node:assert/strict";
import test from "node:test";
import type { Expense } from "@/domain/expense";
import type { Revenue } from "@/domain/revenue";
import {
  expensesToFreeeCsv,
  FREEE_HEADERS,
  OFFICER_LOAN_ACCOUNT,
  revenuesToFreeeCsv,
} from "./freee-csv.ts";

function expense(
  patch: Partial<Expense> & Pick<Expense, "id" | "date" | "amount">,
): Expense {
  return {
    merchant: "AMAZON.CO.JP",
    category: "消耗品費",
    source: "楽天カード",
    note: "",
    createdAt: "2026-09-15T00:00:00.000Z",
    updatedAt: "2026-09-15T00:00:00.000Z",
    ...patch,
  };
}

function lines(csv: string): string[] {
  assert.ok(csv.startsWith("﻿"), "BOM 付き");
  return csv
    .slice(1)
    .split("\r\n")
    .filter((l) => l !== "");
}

test("ヘッダーは freee の独自形式の並び", () => {
  const [header] = lines(expensesToFreeeCsv([]));
  assert.equal(header, FREEE_HEADERS.join(","));
  assert.equal(FREEE_HEADERS.length, 21);
});

test("経費は支出・役員借入金で決済済み。要確認は落とし、日付昇順", () => {
  const csv = expensesToFreeeCsv([
    expense({ id: "b", date: "2025-06-02", amount: 1980 }),
    expense({ id: "x", date: "2025-05-01", amount: 99999, category: "要確認" }),
    expense({
      id: "a",
      date: "2025-05-03",
      amount: 550,
      merchant: 'ETC, "年会費"',
      category: "租税公課",
    }),
  ]);
  const [, r1, r2, rest] = lines(csv);
  assert.equal(rest, undefined);
  assert.equal(
    r1,
    `支出,a,2025/05/03,,,,租税公課,対象外,550,内税,,"ETC, ""年会費""",,,,,,,2025/05/03,${OFFICER_LOAN_ACCOUNT},550`,
  );
  assert.equal(
    r2,
    `支出,b,2025/06/02,,,,消耗品費,課対仕入10%,1980,内税,,AMAZON.CO.JP,,,,,,,2025/06/02,${OFFICER_LOAN_ACCOUNT},1980`,
  );
});

test("売上は収入・売上高・未決済で入れる", () => {
  const rev: Revenue = {
    id: "r1",
    issuerId: "issuer-sample",
    date: "2025-07-31",
    partyName: "株式会社サンプル商事",
    amount: 1_760_000,
    description: "着手金",
    source: "通帳",
    createdAt: "2026-09-15T00:00:00.000Z",
    updatedAt: "2026-09-15T00:00:00.000Z",
  };
  const [, r1] = lines(revenuesToFreeeCsv([rev]));
  assert.equal(
    r1,
    "収入,r1,2025/07/31,,,株式会社サンプル商事,売上高,課税売上10%,1760000,内税,,着手金,,,,,,,,,",
  );
});
