/**
 * expenses タブの件数と費目別合計を表示する確認用スクリプト（ローカル専用）。
 * 使い方: リポジトリ直下で `node scripts/check-expenses.mjs`（.env.local の接続情報を使う）
 */
import { google } from "googleapis";
import { readEnvLocal } from "./env-local.mjs";

const env = readEnvLocal();

const auth = new google.auth.JWT({
  email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const sheets = google.sheets({ version: "v4", auth });
const r = await sheets.spreadsheets.values.get({
  spreadsheetId: env.SHEETS_SPREADSHEET_ID,
  range: "expenses!A:I",
});

const rows = (r.data.values || []).slice(1);
const byCat = {};
let total = 0;
for (const row of rows) {
  const cat = row[4] || "(未設定)";
  const amt = Number(row[3]) || 0;
  byCat[cat] = (byCat[cat] || 0) + amt;
  total += amt;
}
console.log(`件数: ${rows.length} ／ 合計 ¥${total.toLocaleString()}`);
for (const [c, a] of Object.entries(byCat).sort((x, y) => y[1] - x[1])) {
  console.log(`  ${c}: ¥${a.toLocaleString()}`);
}
