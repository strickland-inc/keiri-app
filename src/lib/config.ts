import { z } from "zod";

/**
 * 環境変数。Sheets/AI は未設定でも起動できる（InMemoryバックエンドで動く）。
 * 使う直前に require系ヘルパで存在を強制する。
 * `.env` に `KEY=""` と書いた空の値は、未設定として扱う。
 */
const schema = z.object({
  GOOGLE_SERVICE_ACCOUNT_EMAIL: z.string().email().optional(),
  GOOGLE_PRIVATE_KEY: z.string().optional(),
  SHEETS_SPREADSHEET_ID: z.string().optional(),
  DOCUMENT_TEMPLATE_SPREADSHEET_ID: z.string().optional(),
  DOCUMENT_TEMPLATE_SHEET_ID: z.string().optional(),
  DOCUMENT_OUTPUT_FOLDER_ID: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  TYPESAFE_API_KEY: z.string().optional(),
  TYPESAFE_MODEL: z.string().optional(),
  AGENT_READ_TOKEN: z.string().min(24).optional(),
  AGENT_WRITE_TOKEN: z.string().min(32).optional(),
  AGENT_DOCUMENTS_TOKEN: z.string().min(32).optional(),
});

export type AppConfig = z.infer<typeof schema>;

let cached: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (cached) return cached;
  const raw = {
    GOOGLE_SERVICE_ACCOUNT_EMAIL: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    GOOGLE_PRIVATE_KEY: process.env.GOOGLE_PRIVATE_KEY,
    SHEETS_SPREADSHEET_ID: process.env.SHEETS_SPREADSHEET_ID,
    DOCUMENT_TEMPLATE_SPREADSHEET_ID:
      process.env.DOCUMENT_TEMPLATE_SPREADSHEET_ID,
    DOCUMENT_TEMPLATE_SHEET_ID: process.env.DOCUMENT_TEMPLATE_SHEET_ID,
    DOCUMENT_OUTPUT_FOLDER_ID: process.env.DOCUMENT_OUTPUT_FOLDER_ID,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    TYPESAFE_API_KEY: process.env.TYPESAFE_API_KEY,
    TYPESAFE_MODEL: process.env.TYPESAFE_MODEL,
    AGENT_READ_TOKEN: process.env.AGENT_READ_TOKEN,
    AGENT_WRITE_TOKEN: process.env.AGENT_WRITE_TOKEN,
    AGENT_DOCUMENTS_TOKEN: process.env.AGENT_DOCUMENTS_TOKEN,
  };
  cached = schema.parse(
    Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== "")),
  );
  return cached;
}

/** Sheets接続に必要な設定が揃っているか。 */
export function hasSheetsConfig(): boolean {
  const c = getConfig();
  return Boolean(
    c.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
    c.GOOGLE_PRIVATE_KEY &&
    c.SHEETS_SPREADSHEET_ID,
  );
}

export function requireSheetsConfig(): {
  email: string;
  key: string;
  spreadsheetId: string;
} {
  const c = getConfig();
  if (
    !c.GOOGLE_SERVICE_ACCOUNT_EMAIL ||
    !c.GOOGLE_PRIVATE_KEY ||
    !c.SHEETS_SPREADSHEET_ID
  ) {
    throw new Error(
      "Google Sheets の環境変数が未設定です（GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY / SHEETS_SPREADSHEET_ID）",
    );
  }
  return {
    email: c.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: c.GOOGLE_PRIVATE_KEY,
    spreadsheetId: c.SHEETS_SPREADSHEET_ID,
  };
}

export function hasGeminiConfig(): boolean {
  return Boolean(getConfig().GEMINI_API_KEY);
}

export function requireGeminiKey(): string {
  const c = getConfig();
  if (!c.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY が未設定です");
  }
  return c.GEMINI_API_KEY;
}

export function getAgentReadToken(): string | undefined {
  return getConfig().AGENT_READ_TOKEN;
}

export function getAgentWriteToken(): string | undefined {
  return getConfig().AGENT_WRITE_TOKEN;
}

/**
 * 帳票をスプレッドシートの書式で作るか。
 * テンプレートが未設定なら、帳票はアプリ内で組む PDF だけで出す。
 */
export function hasDocumentTemplateConfig(): boolean {
  return Boolean(getConfig().DOCUMENT_TEMPLATE_SPREADSHEET_ID);
}

/** 書類作成 API 専用のトークン。削除や取引先の変更はできない（作成と一覧の読み取りだけ）。 */
export function getAgentDocumentsToken(): string | undefined {
  return getConfig().AGENT_DOCUMENTS_TOKEN;
}

export function getDocumentTemplateConfig(): {
  spreadsheetId: string;
  sheetId?: number;
  outputFolderId?: string;
} {
  const c = getConfig();
  const spreadsheetId = c.DOCUMENT_TEMPLATE_SPREADSHEET_ID;
  if (!spreadsheetId) {
    throw new Error("DOCUMENT_TEMPLATE_SPREADSHEET_ID が未設定です");
  }

  const rawSheetId = c.DOCUMENT_TEMPLATE_SHEET_ID;
  const sheetId =
    rawSheetId && /^\d+$/.test(rawSheetId) ? Number(rawSheetId) : undefined;

  return {
    spreadsheetId,
    sheetId,
    outputFolderId: c.DOCUMENT_OUTPUT_FOLDER_ID,
  };
}
