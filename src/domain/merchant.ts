/**
 * 利用先の自己学習辞書。
 * 一度確定した利用先（正規化キー）→ 費目/区分を記憶し、次回から AI を介さず即確定する。
 * これにより「よく行く店」ほど分類が決定論的・無料・高速になり、Gemini 呼び出しは初見の店だけに収束する。
 *
 * 正規化キーは normalizeMerchant（./reports）で算出する（表記ゆれを名寄せ）。
 */
import type { ExpenseCategory } from "./expense";

export interface MerchantRule {
  /** normalizeMerchant(merchant) の結果。学習辞書の主キー。 */
  key: string;
  /** 人が見て分かるよう、学習元になった生の利用先名のサンプル。 */
  sampleMerchant: string;
  category: ExpenseCategory;
  updatedAt: string;
}

export type NewMerchantRule = Omit<MerchantRule, "updatedAt">;
