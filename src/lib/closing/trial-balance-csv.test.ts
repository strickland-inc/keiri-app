import assert from "node:assert/strict";
import test from "node:test";
import type { Expense } from "../../domain/expense.ts";
import type { Party } from "../../domain/party.ts";
import { fiscalYear } from "../../domain/fiscal-year.ts";
import { buildClosing } from "../../domain/closing.ts";
import {
  buildTrialBalanceCsv,
  TRIAL_BALANCE_HEADERS,
} from "./trial-balance-csv.ts";

const sampleCompany = {
  fiscalYearEndMonth: 9,
  firstFiscalYearEnd: "2023-09-30",
};
const fy = fiscalYear(sampleCompany, 3); // 2024-10-01〜2025-09-30

function expense(
  patch: Partial<Expense> &
    Pick<Expense, "id" | "date" | "amount" | "category">,
): Expense {
  return {
    merchant: "テスト加盟店",
    source: "楽天カード",
    note: "",
    createdAt: "2024-10-01T00:00:00.000Z",
    updatedAt: "2024-10-01T00:00:00.000Z",
    ...patch,
  };
}

const party: Party = {
  id: "party-1",
  name: "株式会社サンプル",
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
};

function lines(csv: string): string[] {
  assert.ok(csv.startsWith("﻿"), "BOM 付き");
  return csv
    .slice(1)
    .split("\r\n")
    .filter((l) => l !== "");
}

test("ヘッダーは 区分・科目・金額・件数", () => {
  const report = buildClosing({
    fiscalYear: fy,
    expenses: [],
    documents: [],
    revenues: [],
    parties: [],
  });
  const [header] = lines(buildTrialBalanceCsv(report));
  assert.equal(header, TRIAL_BALANCE_HEADERS.join(","));
});

test("売上高・販管費の科目別・販管費計・営業利益・未確定・明細なしの月を1枚にまとめる", () => {
  const report = buildClosing({
    fiscalYear: fy,
    expenses: [
      expense({
        id: "a",
        date: "2024-10-05",
        amount: 3_000,
        category: "通信費",
      }),
      expense({
        id: "b",
        date: "2024-10-06",
        amount: 9_000,
        category: "要確認",
      }),
    ],
    documents: [],
    revenues: [
      {
        id: "r1",
        issuerId: "issuer-sample",
        date: "2024-10-10",
        partyId: "party-1",
        partyName: "株式会社サンプル",
        amount: 100_000,
        description: "着手金",
        source: "通帳",
        createdAt: "2024-10-10T00:00:00.000Z",
        updatedAt: "2024-10-10T00:00:00.000Z",
      },
    ],
    parties: [party],
  });

  const rows = lines(buildTrialBalanceCsv(report)).slice(1);

  assert.equal(rows[0], "売上,売上高,100000,1");
  assert.ok(rows.includes("販管費,通信費,3000,1"));
  assert.ok(rows.includes("販管費,販管費計,3000,"));
  assert.ok(rows.includes("損益,営業利益,97000,"));
  assert.ok(rows.includes("未確定,要確認,9000,1"));

  // 期内12か月のうち明細があるのは10月だけなので、残り11か月が明細なし
  const gapRows = rows.filter((r) => r.startsWith("明細なしの月,"));
  assert.equal(gapRows.length, 11);
  assert.ok(gapRows.includes("明細なしの月,2024-11,,"));
});

test("0円の科目は出さない", () => {
  const report = buildClosing({
    fiscalYear: fy,
    expenses: [],
    documents: [],
    revenues: [],
    parties: [],
  });
  const rows = lines(buildTrialBalanceCsv(report)).slice(1);
  assert.ok(
    !rows.some(
      (r) => r.startsWith("販管費,") && !r.startsWith("販管費,販管費計"),
    ),
  );
});
