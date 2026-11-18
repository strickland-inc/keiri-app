/**
 * 試算表（損益）CSV の組み立て。売上高・販管費の科目別・販管費計・営業利益・
 * 未確定（要確認）の合計と件数・明細なしの月を1枚にまとめる。
 */
import type { ClosingReport } from "@/domain/closing";
import { toCsv } from "./csv.ts";

export const TRIAL_BALANCE_HEADERS = ["区分", "科目", "金額", "件数"] as const;

export function buildTrialBalanceCsv(report: ClosingReport): string {
  const rows: (string | number)[][] = [];

  rows.push([
    "売上",
    "売上高",
    report.revenue.total,
    report.revenue.lines.length,
  ]);

  for (const c of report.sga.byCategory) {
    if (c.amount === 0) continue;
    rows.push(["販管費", c.category, c.amount, c.count]);
  }
  rows.push(["販管費", "販管費計", report.sga.total, ""]);

  rows.push(["損益", "営業利益", report.operatingIncome, ""]);

  rows.push(["未確定", "要確認", report.pending.total, report.pending.count]);

  for (const month of report.gaps) {
    rows.push(["明細なしの月", month, "", ""]);
  }

  return toCsv(TRIAL_BALANCE_HEADERS, rows);
}
