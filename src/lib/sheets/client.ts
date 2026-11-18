import { createSheetsApi } from "@/lib/google/rest";
import { requireSheetsConfig } from "@/lib/config";

type SheetsApi = ReturnType<typeof createSheetsApi>;

let cached: SheetsApi | null = null;

/** サービスアカウント(JWT)で認証した Google Sheets v4 クライアントを返す。 */
export function getSheetsClient(): SheetsApi {
  cached ??= createSheetsApi();
  return cached;
}

export function getSpreadsheetId(): string {
  return requireSheetsConfig().spreadsheetId;
}
