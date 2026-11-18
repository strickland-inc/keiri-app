/**
 * 既存の expenses から自己学習辞書(merchant_rules)を一括生成する（ローカル・初期投入）。
 * 利用先を normalizeMerchant で名寄せし、各利用先で最頻の確定費目（要確認以外）を採用する。
 * これで「よく行く店」が即座にAI不要で分類されるようになる。
 *   node scripts/seed-merchant-rules.mjs
 */
import { google } from "googleapis";
import { readEnvLocal } from "./env-local.mjs";
import { normalizeMerchant } from "./classify.mjs";

const env = readEnvLocal();
const auth = new google.auth.JWT({
  email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const sheets = google.sheets({ version: "v4", auth });
const spreadsheetId = env.SHEETS_SPREADSHEET_ID;
const SHEET = "merchant_rules";
const now = new Date().toISOString();

/** 最頻値を返す。同数なら先に現れたほう。空配列は null。 */
function mostFrequent(arr) {
  const c = new Map();
  for (const v of arr) c.set(v, (c.get(v) ?? 0) + 1);
  let best = null,
    n = 0;
  for (const [v, k] of c)
    if (k > n) {
      best = v;
      n = k;
    }
  return best;
}

// merchant_rules シートが無ければ作成
const meta = await sheets.spreadsheets.get({ spreadsheetId });
if (!meta.data.sheets.some((s) => s.properties.title === SHEET)) {
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: [{ addSheet: { properties: { title: SHEET } } }] },
  });
  console.log(`シート '${SHEET}' を作成しました。`);
}

// expenses 読み込み: id,date,merchant,amount,category,source,note,createdAt,updatedAt
const res = await sheets.spreadsheets.values.get({
  spreadsheetId,
  range: "expenses!A:I",
});
const rows = (res.data.values || []).slice(1);

// 正規化キーごとに集約
const groups = new Map();
for (const r of rows) {
  const merchant = r[2] || "";
  const category = r[4] || "";
  if (!merchant) continue;
  const key = normalizeMerchant(merchant);
  if (!key) continue;
  if (!groups.has(key)) groups.set(key, { sample: merchant, cats: [] });
  const g = groups.get(key);
  if (category && category !== "要確認") g.cats.push(category);
}

// 確定費目が1つでもある利用先のみ辞書化
const out = [];
for (const [key, g] of groups) {
  const category = mostFrequent(g.cats);
  if (!category) continue; // 要確認しかない利用先は学習しない
  out.push([key, g.sample, category, now]);
}
out.sort((a, b) => a[0].localeCompare(b[0], "ja"));

// 全消去してから書き直す。何度実行しても同じ結果になる
await sheets.spreadsheets.values.clear({
  spreadsheetId,
  range: `${SHEET}!A:Z`,
});
await sheets.spreadsheets.values.update({
  spreadsheetId,
  range: `${SHEET}!A1`,
  valueInputOption: "RAW",
  requestBody: {
    values: [["key", "sampleMerchant", "category", "updatedAt"], ...out],
  },
});

console.log(
  `自己学習辞書を ${out.length} 件投入しました（利用先${groups.size}種から確定費目ありを抽出）。`,
);
