/**
 * PayPay 取引履歴CSVを取り込み、費目を仕分けして Sheets の expenses タブへ保存する（ローカル）。
 * PayPay の取引履歴は「支払い（出金）」のほか「チャージ」「入金」を含むが、
 * 経費対象は出金（支払い）のみ。チャージ／入金は残高移動なので除外する。
 *
 *   node scripts/import-paypay.mjs <csv> [<csv> ...]
 *
 * 認証: .env.local（GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY / SHEETS_SPREADSHEET_ID / GEMINI_API_KEY）。
 */
import { google } from "googleapis";
import { classify } from "./classify.mjs";
import fs from "node:fs";
import path from "node:path";
import { readEnvLocal } from "./env-local.mjs";

const SHEET_NAME = "expenses";
const SOURCE = "PayPay";

function splitCsvLine(line) {
  const out = [];
  let cur = "",
    q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === "," && !q) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function normDate(s) {
  const m = s.match(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  if (!m) return "";
  return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
}

/** PayPay取引CSV（UTF-8 BOM）をパース。出金（支払い）行のみ {date, merchant, amount} で返す。 */
function parsePayPayCsv(buf) {
  const text = new TextDecoder("utf-8").decode(buf).replace(/^﻿/, "");
  const rows = text
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map(splitCsvLine);
  if (rows.length === 0) return [];
  const header = rows[0];
  const idx = (re) => header.findIndex((h) => re.test(h));
  const di = idx(/取引日/);
  const oi = idx(/出金金額/);
  const ti = idx(/取引内容/);
  const mi = idx(/取引先/);
  const out = [];
  for (const r of rows.slice(1)) {
    const amount = Number((r[oi] ?? "").replace(/[^\d-]/g, "")) || 0;
    if (amount <= 0) continue; // 出金のみ（チャージ・入金は残高移動なので除外）
    const date = normDate(r[di] ?? "");
    if (!date) continue;
    // 取引先が空の行（個人間送金など）は取引内容を利用先として使う
    const kind = (r[ti] ?? "").trim();
    const merchant = (r[mi] ?? "").trim() || kind || "PayPay";
    out.push({ date, merchant, amount });
  }
  return out;
}

function sheetsClient(env) {
  const auth = new google.auth.JWT({
    email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

/** 自己学習辞書(merchant_rules)を { 正規化キー: 費目 } で読み込む。無ければ空。 */
async function loadLearnedMap(env) {
  try {
    const sheets = sheetsClient(env);
    const r = await sheets.spreadsheets.values.get({
      spreadsheetId: env.SHEETS_SPREADSHEET_ID,
      range: "merchant_rules!A:E",
    });
    const map = {};
    for (const row of (r.data.values ?? []).slice(1))
      if (row[0] && row[2]) map[row[0]] = row[2];
    return map;
  } catch {
    return {};
  }
}

async function saveToSheets(env, expenses) {
  const sheets = sheetsClient(env);
  const spreadsheetId = env.SHEETS_SPREADSHEET_ID;

  // 取込済みの判定キーは date|merchant|amount。列は A=id, B=date, C=merchant, D=amount
  const existing = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEET_NAME}!A:Z`,
  });
  const rows = existing.data.values ?? [];
  const seen = new Set(rows.slice(1).map((r) => `${r[1]}|${r[2]}|${r[3]}`));
  const now = new Date().toISOString();
  const fresh = expenses.filter(
    (e) => !seen.has(`${e.date}|${e.merchant}|${e.amount}`),
  );
  if (fresh.length === 0) {
    console.log("新規明細なし（すべて取込済み）");
    return 0;
  }
  const values = fresh.map((e) => [
    globalThis.crypto.randomUUID(),
    e.date,
    e.merchant,
    String(e.amount),
    e.category,
    SOURCE,
    "",
    now,
    now,
  ]);
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${SHEET_NAME}!A:A`,
    valueInputOption: "RAW",
    requestBody: { values },
  });
  return fresh.length;
}

async function main() {
  const env = { ...readEnvLocal(), ...process.env };
  const csvPaths = process.argv.slice(2);
  if (csvPaths.length === 0) {
    console.error("使い方: node scripts/import-paypay.mjs <csv> [<csv> ...]");
    process.exit(1);
  }

  let items = [];
  for (const p of csvPaths) {
    const parsed = parsePayPayCsv(fs.readFileSync(p));
    console.log(`${path.basename(p)}: 支払い ${parsed.length} 件`);
    items = items.concat(parsed);
  }
  console.log(`合計 ${items.length} 件を読み込み。費目を仕分け中...`);
  const learnedMap = await loadLearnedMap(env);
  const categorized = await classify(items, env.GEMINI_API_KEY, learnedMap);
  const saved = await saveToSheets(env, categorized);
  console.log(
    `完了: ${saved} 件を expenses に保存しました（source=${SOURCE}）。`,
  );
}

main().catch((e) => {
  console.error("エラー:", e?.message ?? e);
  process.exit(1);
});
