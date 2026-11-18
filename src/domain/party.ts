/** 取引先（請求・見積などの宛先）。番号で呼び出して入力レスにする。 */
export interface Party {
  id: string;
  /** 宛名（会社名・屋号・個人名）。 */
  name: string;
  /** 担当者名（「様」で表示）。任意。 */
  contactName?: string;
  /** 敬称：御中 / 様。 */
  honorific?: "御中" | "様";
  postalCode?: string;
  address?: string;
  email?: string;
  phone?: string;
  /** 取引先のインボイス登録番号（任意）。 */
  registrationNumber?: string;
  /** よく使う件名（新規作成時の初期値）。 */
  defaultTitle?: string;
  createdAt: string;
  updatedAt: string;
}

export type NewPartyInput = Omit<Party, "id" | "createdAt" | "updatedAt">;
