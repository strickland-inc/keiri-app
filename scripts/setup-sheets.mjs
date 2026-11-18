/**
 * バックエンド用のスプレッドシートに、サービスアカウントが届くかを確かめ、
 * .env.local の Google Sheets の3項目（GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY /
 * SHEETS_SPREADSHEET_ID）を書き込む。ほかの行はそのまま残す。
 * 秘密情報（private_key）は標準出力に出さない。
 *
 * サービスアカウントは自分では新しいスプレッドシートを作れない（Drive の保存容量が無いため）。
 * 先に自分の Google ドライブで空のスプレッドシートを作り、サービスアカウントのメールアドレスに
 * 「編集者」で共有しておく。
 *
 * 使い方: node scripts/setup-sheets.mjs <サービスアカウントの JSON キーのパス> <スプレッドシートの URL か ID>
 */
import { google } from "googleapis";
import fs from "node:fs";
import path from "node:path";
import { APP_ROOT } from "./env-local.mjs";

const [keyPath, target] = process.argv.slice(2);
if (!keyPath || !target) {
  console.error(
    "使い方: node scripts/setup-sheets.mjs <JSON キーのパス> <スプレッドシートの URL か ID>",
  );
  process.exit(1);
}

const spreadsheetId =
  target.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]+)/)?.[1] ?? target;
const key = JSON.parse(fs.readFileSync(keyPath, "utf8"));

const auth = new google.auth.JWT({
  email: key.client_email,
  key: key.private_key,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const sheets = google.sheets({ version: "v4", auth });

try {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  console.log(`届きました: ${meta.data.properties?.title ?? spreadsheetId}`);
} catch (error) {
  console.error(
    `スプレッドシートに届きません。${key.client_email} に「編集者」で共有したか確認してください。`,
  );
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

const values = {
  GOOGLE_SERVICE_ACCOUNT_EMAIL: key.client_email,
  GOOGLE_PRIVATE_KEY: `"${key.private_key.replace(/\n/g, "\\n")}"`,
  SHEETS_SPREADSHEET_ID: spreadsheetId,
};

const envPath = path.join(APP_ROOT, ".env.local");
const lines = fs.existsSync(envPath)
  ? fs.readFileSync(envPath, "utf8").split("\n")
  : [];
const written = new Set();
const next = lines.map((line) => {
  const name = line.match(/^([A-Z0-9_]+)=/)?.[1];
  if (!name || !(name in values)) return line;
  written.add(name);
  return `${name}=${values[name]}`;
});
for (const [name, value] of Object.entries(values)) {
  if (!written.has(name)) next.push(`${name}=${value}`);
}
fs.writeFileSync(envPath, next.join("\n").replace(/\n*$/, "\n"), {
  mode: 0o600,
});

console.log("SHEETS_SPREADSHEET_ID=" + spreadsheetId);
console.log(
  ".env.local に Google Sheets の設定を書きました（秘密鍵は表示しません）",
);
