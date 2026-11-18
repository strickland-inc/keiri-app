/**
 * expenses 全件を会計プロ基準（scripts/classify.mjs）で再分類する（ローカル）。
 * ルール辞書で確定できるものは確定、残りだけ Gemini。手修正済みも上書きするので注意。
 *   node scripts/reclassify-expenses.mjs
 */
import { google } from "googleapis";
import { readEnvLocal } from "./env-local.mjs";
import { classify } from "./classify.mjs";

const env = readEnvLocal();

const auth = new google.auth.JWT({
  email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const sheets = google.sheets({ version: "v4", auth });
const spreadsheetId = env.SHEETS_SPREADSHEET_ID;

const res = await sheets.spreadsheets.values.get({
  spreadsheetId,
  range: "expenses!A:I",
});
const rows = res.data.values || [];
const items = rows.slice(1).map((row, i) => ({
  rowNum: i + 2,
  merchant: row[2] || "",
  amount: Number(row[3]) || 0,
  current: row[4] || "",
}));
console.log(`対象 ${items.length} 件を再分類中...`);

// 自己学習辞書(merchant_rules)を読み込み、確定済み利用先は AI を介さず優先適用する
let learnedMap = {};
try {
  const lr = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "merchant_rules!A:E",
  });
  for (const row of (lr.data.values ?? []).slice(1))
    if (row[0] && row[2]) learnedMap[row[0]] = row[2];
} catch {
  // merchant_rules シートが無ければ学習済みルールなしで進める
}

const classified = await classify(
  items.map((it) => ({ merchant: it.merchant, amount: it.amount })),
  env.GEMINI_API_KEY,
  learnedMap,
);

// 費目が変わった行だけ、E列（費目）と I列（更新日時）を書き換える
const now = new Date().toISOString();
const data = [];
let changed = 0;
items.forEach((it, i) => {
  const cat = classified[i].category;
  if (cat && cat !== it.current) {
    data.push({ range: `expenses!E${it.rowNum}`, values: [[cat]] });
    data.push({ range: `expenses!I${it.rowNum}`, values: [[now]] });
    changed++;
  }
});

if (data.length > 0) {
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: { valueInputOption: "RAW", data },
  });
}
console.log(`完了: ${changed} 件を更新しました。`);
