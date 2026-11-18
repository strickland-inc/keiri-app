/** 売上台帳。帳票（請求書）が無い入金を通帳などから手で記録するための行。 */
export interface Revenue {
  id: string;
  /** 所属する会社（Issuer.id）。作成時は選択中の会社で固定する。 */
  issuerId: string;
  /** 入金日 or 売上計上日 YYYY-MM-DD */
  date: string;
  /** 取引先（任意）。 */
  partyId?: string;
  /** 表示用。partyId があればその名前を入れて保存する。 */
  partyName: string;
  /** 円・整数（税込。免税事業者は税込経理）。 */
  amount: number;
  /** 摘要。 */
  description: string;
  /** "通帳" | "手入力" | "請求書" など自由文字列。 */
  source: string;
  /** 対応する請求書があれば。 */
  documentId?: string;
  createdAt: string;
  updatedAt: string;
}

export type NewRevenueInput = Omit<Revenue, "id" | "createdAt" | "updatedAt">;
