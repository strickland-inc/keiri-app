/**
 * 楽天カード明細を取り込み、費目を仕分けして Sheets の expenses タブへ保存する。
 * ローカル専用（Cloudflare Workers などのサーバーでは動かさない）。
 *
 * 使い方:
 *   node scripts/import-rakuten.mjs login          # ブラウザでe-NAVIに手動ログイン→セッション保存（初回・期限切れ時）
 *   node scripts/import-rakuten.mjs fetch          # 保存セッションで明細CSVを自動DL→仕分け→Sheets保存
 *   node scripts/import-rakuten.mjs import <csv>   # 手動DLしたCSVを仕分け→Sheets保存（フォールバック）
 *   node scripts/import-rakuten.mjs import-pdf <pdf...> [--dry-run] [--from YYYY-MM-DD --to YYYY-MM-DD]
 *                                                  # e-NAVIの「ご利用代金請求明細書」PDFを取込（pdftotext -layout で解析）
 *
 * 認証:
 *   - 楽天IDは環境変数 RAKUTEN_ENAVI_USER / RAKUTEN_ENAVI_PASSWORD（シェルに export 済みの前提）。
 *   - Sheets / Gemini は .env.local（GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY / SHEETS_SPREADSHEET_ID / GEMINI_API_KEY）。
 *   - ブラウザのログインセッションは scripts/.rakuten-session.json（gitignore）。2段階認証は初回だけ手動で通す。
 */
import { chromium } from "playwright";
import { google } from "googleapis";
import { classify } from "./classify.mjs";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { readEnvLocal } from "./env-local.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SESSION_PATH = path.join(__dirname, ".rakuten-session.json");

const ENAVI_URL = "https://www.rakuten-card.co.jp/e-navi/";
const GOTO_OPTS = { waitUntil: "domcontentloaded", timeout: 60000 };
const SHEET_NAME = "expenses";

// ── 共通ユーティリティ ──────────────────────────────────────────────

function prompt(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) =>
    rl.question(question, (a) => {
      rl.close();
      resolve(a);
    }),
  );
}

/** 楽天カード明細CSVをパースして {date, merchant, amount} の配列にする。 */
function parseRakutenCsv(buf) {
  // 楽天CSVは時期により UTF-8(BOM) か Shift_JIS。UTF-8 で読み、見出しが読めなければ Shift_JIS。
  let text = new TextDecoder("utf-8").decode(buf).replace(/^﻿/, "");
  if (!/利用日|利用金額|金額/.test(text)) {
    text = new TextDecoder("shift_jis").decode(buf);
  }
  const rows = text
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map(splitCsvLine);
  if (rows.length === 0) return [];
  const header = rows[0];
  const idx = (re) => header.findIndex((h) => re.test(h));
  const di = idx(/利用日|ご利用日/);
  const mi = idx(/利用店名|ご利用先|商品名|利用先/);
  const ai = idx(/利用金額|ご利用金額|支払金額|金額/);
  const out = [];
  for (const r of rows.slice(1)) {
    const date = normDate(r[di] ?? "");
    const merchant = (r[mi] ?? "").trim();
    const amount = Number((r[ai] ?? "").replace(/[^\d-]/g, "")) || 0;
    if (date && merchant && amount) out.push({ date, merchant, amount });
  }
  return out;
}

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

// ── PDF（ご利用代金請求明細書）パース ──────────────────────────────────

const PDF_DATE_LINE_RE = /^(\d{4}\/\d{2}\/\d{2})\s+(.*)$/;
const PDF_MERCHANT_RE = /^(.*?)\s*本人(\*)?\s*(.*)$/;
const PDF_PAYMENT_RE = /^(\S*払い(?:\([^)]*\))?)\s+(.*)$/;
const PDF_DISCOUNT_RE = /^\s*割引\s+([‑-]?[\d,]+)\s*$/;
const PDF_INSTALLMENT_RE = /^分割\d+回払い\((\d+)回目\)$/;

/**
 * `pdftotext -layout` で抽出した楽天カード「ご利用代金請求明細書」のテキストから
 * 明細行 {date, merchant, amount} の配列を作る。ヘッダー・注記・現地利用額の行は無視する。
 * `割引` 行は直前の明細に加算し、0以下になったら落とす。
 * 分割払いの2回目以降、リボ払いの継続分（利用者欄に本人*のアスタリスクが無い行＝
 * 「※ 利用者欄に*表示のある明細は、同月新規のご利用分」に該当しない継続行）は、
 * 初回の請求月に取り込み済みの同じ取引なので落とす。
 */
export function parseRakutenStatementPdf(text) {
  const lines = text.split(/\r?\n/);
  const items = [];
  for (const raw of lines) {
    const trimmed = raw.trim();
    if (!trimmed) continue;

    const discountMatch = raw.match(PDF_DISCOUNT_RE);
    if (discountMatch) {
      const amount = Number(
        discountMatch[1].replace(/‑/g, "-").replace(/,/g, ""),
      );
      if (items.length > 0 && Number.isFinite(amount)) {
        items[items.length - 1].amount += amount;
      }
      continue;
    }

    const dateMatch = trimmed.match(PDF_DATE_LINE_RE);
    if (!dateMatch) continue;
    const rest = dateMatch[2];
    if (!rest.includes("本人")) continue; // お支払日など、明細行以外の日付行を除く
    const merchantMatch = rest.match(PDF_MERCHANT_RE);
    if (!merchantMatch) continue;
    const merchant = merchantMatch[1].trim().replace(/\s+/g, " ");
    const hasAsterisk = merchantMatch[2] === "*";
    const paymentMatch = merchantMatch[3].match(PDF_PAYMENT_RE);
    if (!merchant || !paymentMatch) continue;
    const paymentMethod = paymentMatch[1];
    const installmentMatch = paymentMethod.match(PDF_INSTALLMENT_RE);
    if (installmentMatch && Number(installmentMatch[1]) >= 2) continue; // 分割2回目以降＝初回の月に取込済み
    if (paymentMethod.startsWith("リボ") && !hasAsterisk) continue; // リボの継続分＝初回の月に取込済み
    const firstToken = paymentMatch[2].trim().split(/\s+/)[0] ?? "";
    const amount = Number(firstToken.replace(/,/g, ""));
    if (!Number.isFinite(amount)) continue;
    items.push({ date: dateMatch[1].replace(/\//g, "-"), merchant, amount });
  }
  return items.filter((it) => it.amount > 0);
}

function ensurePdftotext() {
  const r = spawnSync("pdftotext", ["-v"]);
  if (r.error && r.error.code === "ENOENT") {
    console.error(
      "pdftotext が見つかりません。`brew install poppler` を実行してください。",
    );
    process.exit(1);
  }
}

function pdfToText(pdfPath) {
  const r = spawnSync("pdftotext", ["-layout", "-enc", "UTF-8", pdfPath, "-"], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 20,
  });
  if (r.status !== 0) {
    throw new Error(`pdftotext 失敗: ${pdfPath}: ${r.stderr || r.status}`);
  }
  return r.stdout;
}

function parseImportPdfArgs(argv) {
  const pdfPaths = [];
  let dryRun = false;
  let from, to;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") dryRun = true;
    else if (a === "--from") from = argv[++i];
    else if (a === "--to") to = argv[++i];
    else pdfPaths.push(a);
  }
  return { pdfPaths, dryRun, from, to };
}

function printPdfDryRun(perFile, items) {
  console.log("対象PDF別の件数:");
  for (const f of perFile) console.log(`  ${f.file}: ${f.count}件`);

  const byMonth = new Map();
  for (const it of items) {
    const ym = it.date.slice(0, 7);
    const cur = byMonth.get(ym) ?? { count: 0, amount: 0 };
    cur.count += 1;
    cur.amount += it.amount;
    byMonth.set(ym, cur);
  }
  console.log("\n利用月別:");
  for (const ym of [...byMonth.keys()].sort()) {
    const { count, amount } = byMonth.get(ym);
    console.log(`  ${ym}: ${count}件 ¥${amount.toLocaleString("ja-JP")}`);
  }

  console.log("\n先頭10件:");
  for (const it of items.slice(0, 10)) {
    console.log(
      `  ${it.date} ${it.merchant} ¥${it.amount.toLocaleString("ja-JP")}`,
    );
  }

  const total = items.reduce((s, it) => s + it.amount, 0);
  console.log(`\n合計: ${items.length}件 ¥${total.toLocaleString("ja-JP")}`);
}

async function importPdf(env, argv) {
  ensurePdftotext();
  const { pdfPaths, dryRun, from, to } = parseImportPdfArgs(argv);
  if (pdfPaths.length === 0) {
    console.error(
      "使い方: import-pdf <pdf...> [--dry-run] [--from YYYY-MM-DD --to YYYY-MM-DD]",
    );
    process.exit(1);
  }

  const perFile = [];
  let all = [];
  for (const pdfPath of pdfPaths) {
    const text = pdfToText(pdfPath);
    let items = parseRakutenStatementPdf(text);
    if (from) items = items.filter((it) => it.date >= from);
    if (to) items = items.filter((it) => it.date <= to);
    perFile.push({ file: pdfPath, count: items.length });
    all = all.concat(items);
  }

  if (dryRun) {
    printPdfDryRun(perFile, all);
    return;
  }

  console.log(`明細 ${all.length} 件を読み込み。費目を仕分け中...`);
  await classifyAndSave(env, all);
}

// ── Sheets 保存 ──────────────────────────────────────────────────────

function sheetsClient(env) {
  const auth = new google.auth.JWT({
    email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
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
    "楽天カード",
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

// ── ブラウザ操作 ─────────────────────────────────────────────────────

async function login(env) {
  const browser = await chromium.launch({ headless: false });
  const ctx = await browser.newContext({ acceptDownloads: true });
  const page = await ctx.newPage();
  await page.goto(ENAVI_URL, GOTO_OPTS);
  console.log("ブラウザでログイン（ID/PW・2段階認証）を完了してください。");
  if (env.RAKUTEN_ENAVI_USER) {
    console.log(
      `  ヒント: ユーザーID = ${env.RAKUTEN_ENAVI_USER}（パスワードは各自のパスワード管理ツールから入力）`,
    );
  }
  await prompt("e-NAVIにログインして明細ページが表示できたら Enter を押す...");
  await ctx.storageState({ path: SESSION_PATH });
  console.log(`セッションを保存しました: ${SESSION_PATH}`);
  await browser.close();
}

async function fetch_() {
  if (!fs.existsSync(SESSION_PATH)) {
    console.error(
      "セッション未保存。先に `node scripts/import-rakuten.mjs login` を実行してください。",
    );
    process.exit(1);
  }
  const browser = await chromium.launch({ headless: false });
  const ctx = await browser.newContext({
    storageState: SESSION_PATH,
    acceptDownloads: true,
  });
  const page = await ctx.newPage();
  await page.goto(ENAVI_URL, GOTO_OPTS);
  console.log(
    "明細ページ（ご利用明細）へ移動し、CSVダウンロードを押してください（DL完了を自動検知します）。",
  );
  const dl = await page.waitForEvent("download", { timeout: 120000 });
  const tmp = path.join(__dirname, ".rakuten-latest.csv");
  await dl.saveAs(tmp);
  await ctx.storageState({ path: SESSION_PATH }); // 期限を延ばすため更新したセッションを保存
  await browser.close();
  return tmp;
}

// ── メイン ───────────────────────────────────────────────────────────

async function classifyAndSave(env, items) {
  let learnedMap = {};
  try {
    const r = await sheetsClient(env).spreadsheets.values.get({
      spreadsheetId: env.SHEETS_SPREADSHEET_ID,
      range: "merchant_rules!A:E",
    });
    for (const row of (r.data.values ?? []).slice(1))
      if (row[0] && row[2]) learnedMap[row[0]] = row[2];
  } catch {
    // merchant_rules シートが無ければ学習済みルールなしで進める
  }
  const categorized = await classify(items, env.GEMINI_API_KEY, learnedMap);
  const saved = await saveToSheets(env, categorized);
  console.log(`完了: ${saved} 件を expenses に保存しました。`);
}

async function main() {
  const env = { ...readEnvLocal(), ...process.env };
  const mode = process.argv[2];

  if (mode === "login") {
    await login(env);
    return;
  }

  if (mode === "import-pdf") {
    await importPdf(env, process.argv.slice(3));
    return;
  }

  let csvPath;
  if (mode === "fetch") {
    csvPath = await fetch_();
  } else if (mode === "import") {
    csvPath = process.argv[3];
    if (!csvPath) {
      console.error("CSVパスを指定: import <csv>");
      process.exit(1);
    }
  } else {
    console.error(
      "使い方: login | fetch | import <csv> | import-pdf <pdf...> [--dry-run] [--from --to]",
    );
    process.exit(1);
  }

  const items = parseRakutenCsv(fs.readFileSync(csvPath));
  console.log(`明細 ${items.length} 件を読み込み。費目を仕分け中...`);
  await classifyAndSave(env, items);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error("エラー:", e?.message ?? e);
    process.exit(1);
  });
}
