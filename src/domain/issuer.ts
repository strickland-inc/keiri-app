/**
 * 発行元（自社）。請求書等の差出人であり、**アプリ上の「会社」そのもの**。
 * 帳票・経費・レポートはすべてこの id でスコープされる
 * （複数の会社の帳簿を1つのアプリで分けて持つ）。
 * お金コーチは本人のお金を見る画面なので、会社をまたぐ。
 */
export interface Issuer {
  id: string;
  /** 自社名・屋号。 */
  name: string;
  /** 記載名義。帳票で会社名の下に載せる氏名（例: 代表者名）。 */
  signatoryName?: string;
  postalCode?: string;
  address?: string;
  /** 建物名など住所2行目。 */
  building?: string;
  phone?: string;
  email?: string;
  /** インボイス登録番号 T+13桁。 */
  registrationNumber?: string;
  /** 振込先（複数行可）。 */
  bankInfo?: string;
  /** 印影画像URL（任意）。 */
  sealImageUrl?: string;
  /** 既定の発行元か。 */
  isDefault?: boolean;
  /** 決算月 1〜12。9 なら 9月30日決算。 */
  fiscalYearEndMonth?: number;
  /** 第1期の期末日 YYYY-MM-DD。期数の起点（例 "2023-09-30"）。 */
  firstFiscalYearEnd?: string;
  createdAt: string;
  updatedAt: string;
}

export type NewIssuerInput = Omit<Issuer, "id" | "createdAt" | "updatedAt">;
