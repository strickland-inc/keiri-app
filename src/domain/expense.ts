// 個人事業・中小法人で使う標準的な経費科目。
// 「要確認」は、高額・私的利用の疑いなどで人が確かめる必要があるもの。雑費で済ませない。
export const EXPENSE_CATEGORIES = [
  "旅費交通費",
  "通信費",
  "消耗品費",
  "会議費",
  "接待交際費",
  "広告宣伝費",
  "新聞図書費",
  "研修費",
  "支払手数料",
  "外注費",
  "荷造運賃",
  "水道光熱費",
  "地代家賃",
  "修繕費",
  "保険料",
  "租税公課",
  "福利厚生費",
  "車両費",
  "諸会費",
  "雑費",
  "要確認",
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export interface Expense {
  id: string;
  /**
   * 所属する会社（Issuer.id）。会社スコープの経費集計に使う。
   * 未設定は会社導入前の既存データで、既定会社のものとして扱う。
   */
  issuerId?: string;
  date: string;
  merchant: string;
  amount: number;
  category: ExpenseCategory;
  source: string;
  note: string;
  /** 家計予測上の負担者。未設定は本人負担として後方互換で扱う。 */
  responsibility?: "self" | "other";
  /** 利用月とカード引落月が異なる場合の対象月（YYYY-MM）。 */
  expectedDebitMonth?: string;
  /** 速報版など、金額がまだ確定していない明細の状態。 */
  settlementStatus?: "confirmed" | "provisional";
  createdAt: string;
  updatedAt: string;
}

export type NewExpenseInput = Omit<Expense, "id" | "createdAt" | "updatedAt">;

export function isExpenseCategory(v: string): v is ExpenseCategory {
  return (EXPENSE_CATEGORIES as readonly string[]).includes(v);
}
