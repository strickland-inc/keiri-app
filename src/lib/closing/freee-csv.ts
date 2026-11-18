/**
 * freee会計「取引・口座振替のインポート（一括登録）」形式の CSV を組む。
 * 仕様: https://support.freee.co.jp/hc/ja/articles/202847320
 *
 * - 列の並びと名前は freee の独自形式に固定。1行目はヘッダー
 * - 金額は税込・整数。免税事業者でも税区分は実態の区分を入れる（空欄不可）
 * - 経費は代表者の個人カード立替なので、決済口座を「役員借入金」にして決済済みで入れる
 * - 売上は決済口座を空にして未決済で入れ、freee 側の口座同期で消し込む
 * - 「要確認」は費目が確定していないので出力しない
 */
import type { Expense } from "@/domain/expense";
import type { Revenue } from "@/domain/revenue";
import { toCsv } from "./csv.ts";

export const FREEE_HEADERS = [
  "収支区分",
  "管理番号",
  "発生日",
  "決済期日",
  "取引先コード",
  "取引先",
  "勘定科目",
  "税区分",
  "金額",
  "税計算区分",
  "税額",
  "備考",
  "品目",
  "部門",
  "メモタグ",
  "セグメント1",
  "セグメント2",
  "セグメント3",
  "決済日",
  "決済口座",
  "決済金額",
] as const;

/** 代表者が個人カードで立て替えた経費の決済口座（freee 法人の固定表記）。 */
export const OFFICER_LOAN_ACCOUNT = "役員借入金";

const PURCHASE_TAX = "課対仕入10%";
const SALES_TAX = "課税売上10%";
const OUT_OF_SCOPE_TAX = "対象外";

/**
 * 課税仕入にならない費目。税金は不課税。
 * 免税事業者のうちは税区分が決算に影響しないので、迷う科目は課対仕入のまま freee 側で直す。
 */
const TAX_BY_CATEGORY: Readonly<Record<string, string>> = {
  租税公課: OUT_OF_SCOPE_TAX,
};

function freeeDate(iso: string): string {
  return iso.replace(/-/g, "/");
}

/**
 * 経費の決済口座。カードの引落口座が代表者個人なら「役員借入金」、法人口座なら
 * freee に登録したクレジットカード口座の名前（例 "楽天カード"）を渡す。
 */
export interface ExpenseCsvOptions {
  settlementAccount?: string;
}

function expenseToFreeeRow(
  e: Expense,
  { settlementAccount = OFFICER_LOAN_ACCOUNT }: ExpenseCsvOptions = {},
): (string | number)[] {
  const date = freeeDate(e.date);
  const note = e.note ? `${e.merchant} / ${e.note}` : e.merchant;
  const tax = TAX_BY_CATEGORY[e.category] ?? PURCHASE_TAX;
  return [
    "支出",
    e.id,
    date,
    "",
    "",
    "",
    e.category,
    tax,
    e.amount,
    "内税",
    "",
    note,
    "",
    "",
    "",
    "",
    "",
    "",
    date,
    settlementAccount,
    e.amount,
  ];
}

function revenueToFreeeRow(r: Revenue): (string | number)[] {
  return [
    "収入",
    r.id,
    freeeDate(r.date),
    "",
    "",
    r.partyName,
    "売上高",
    SALES_TAX,
    r.amount,
    "内税",
    "",
    r.description,
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
  ];
}

/** 経費の取込 CSV。要確認は落とす。日付昇順。 */
export function expensesToFreeeCsv(
  expenses: readonly Expense[],
  options: ExpenseCsvOptions = {},
): string {
  const rows = expenses
    .filter((e) => e.category !== "要確認")
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .map((e) => expenseToFreeeRow(e, options));
  return toCsv(FREEE_HEADERS, rows);
}

/** 売上の取込 CSV。日付昇順。 */
export function revenuesToFreeeCsv(revenues: readonly Revenue[]): string {
  const rows = [...revenues]
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .map(revenueToFreeeRow);
  return toCsv(FREEE_HEADERS, rows);
}
