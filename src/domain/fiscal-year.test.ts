import assert from "node:assert/strict";
import test from "node:test";
import {
  currentTerm,
  fiscalYear,
  fiscalYearOf,
  hasFiscalSettings,
  listFiscalYears,
} from "./fiscal-year.ts";

const sampleCompany = {
  fiscalYearEndMonth: 9,
  firstFiscalYearEnd: "2023-09-30",
};

test("fiscalYear: 第3期は前期の翌日から決算月末日まで", () => {
  const fy = fiscalYear(sampleCompany, 3);
  assert.equal(fy.from, "2024-10-01");
  assert.equal(fy.to, "2025-09-30");
  assert.equal(fy.label, "第3期（2024/10/1〜2025/9/30）");
});

test("fiscalYear: 第1期の from は第1期末日の1年前の翌日", () => {
  const fy = fiscalYear(sampleCompany, 1);
  assert.equal(fy.from, "2022-10-01");
  assert.equal(fy.to, "2023-09-30");
});

test("fiscalYear: 決算月2月は閏年の末日を正しく扱う", () => {
  const issuer = { fiscalYearEndMonth: 2, firstFiscalYearEnd: "2024-02-29" };

  const term1 = fiscalYear(issuer, 1);
  assert.equal(term1.to, "2024-02-29");

  const term2 = fiscalYear(issuer, 2);
  assert.equal(term2.from, "2024-03-01");
  assert.equal(term2.to, "2025-02-28");
});

test("listFiscalYears: today を含む期まで第1期から並ぶ", () => {
  const list = listFiscalYears(sampleCompany, new Date("2026-09-15"));
  assert.equal(list.length, 4);
  assert.deepEqual(
    list.map((fy) => fy.term),
    [1, 2, 3, 4],
  );
  assert.equal(list[3].from, "2025-10-01");
  assert.equal(list[3].to, "2026-09-30");
});

test("currentTerm: today=2026-09-15 は第4期", () => {
  assert.equal(currentTerm(sampleCompany, new Date("2026-09-15")), 4);
});

test("fiscalYearOf: 期内の日付から期を引ける", () => {
  const fy = fiscalYearOf(sampleCompany, "2025-05-03");
  assert.ok(fy);
  assert.equal(fy?.term, 3);
});

test("hasFiscalSettings: 設定が無ければ false", () => {
  assert.equal(hasFiscalSettings({}), false);
  assert.equal(hasFiscalSettings(sampleCompany), true);
});
