#!/usr/bin/env node
/**
 * freee会計 API の CLI。ローカル専用（Cloudflare Workers などのサーバーでは動かさない）。
 *
 * 認証情報は、環境変数か .env.local に置く。
 *   FREEE_CLIENT_ID / FREEE_CLIENT_SECRET   freee developers で作ったプライベートアプリ
 * 認可後のトークン（リフレッシュトークンと、6時間有効のアクセストークン）は
 * scripts/.freee-token.json に保存する（gitignore。権限 0600）。リフレッシュトークンは使うたびに新しい値へ置き換わる。
 *
 * 使い方:
 *   node scripts/freee.mjs auth-url                   認可 URL を出す（ブラウザで開いて事業所を選び許可する）
 *   node scripts/freee.mjs auth <認可コード>            コードをトークンに替えて scripts/.freee-token.json に保存する
 *   node scripts/freee.mjs companies                  事業所一覧
 *   node scripts/freee.mjs company <id>               事業所の詳細（会計期間・税設定）
 *   node scripts/freee.mjs walletables <id>           口座一覧（同期状況・残高）
 *   node scripts/freee.mjs trial-pl <id> <fiscal_year>   損益の試算表（会計年度＝期首の年）
 *   node scripts/freee.mjs trial-bs <id> <fiscal_year>   貸借の試算表
 *   node scripts/freee.mjs deals <id> <from> <to>     取引（日付は YYYY-MM-DD）
 *   node scripts/freee.mjs wallet-txns <id> <from> <to>  口座明細
 *   node scripts/freee.mjs account-items <id>         勘定科目
 *   node scripts/freee.mjs get <path> [k=v ...]       任意の GET（例 get /api/1/taxes/companies/123）
 *   node scripts/freee.mjs post-bank-rows <company_id> <walletable_id> <rows.json> --before <date> [--execute]
 *                                                     銀行 CSV から作った行を口座明細として登録（既定は dry-run）
 * 結果は JSON で stdout に出す。書き込むのは post-bank-rows だけで、--execute が無ければ書かない。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readEnvLocal } from "./env-local.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOKEN_CACHE = path.join(__dirname, ".freee-token.json");

const AUTH_BASE = "https://accounts.secure.freee.co.jp/public_api";
const API_BASE = "https://api.freee.co.jp";
const REDIRECT_URI = "urn:ietf:wg:oauth:2.0:oob";

// ── 設定 ─────────────────────────────────────────────────────────────

const localEnv = readEnvLocal();

/** 環境変数を先に、無ければ .env.local の値を返す。 */
function setting(name) {
  return process.env[name] || localEnv[name] || "";
}

function requireClient() {
  const id = setting("FREEE_CLIENT_ID");
  const secret = setting("FREEE_CLIENT_SECRET");
  if (!id || !secret) {
    fail(
      "FREEE_CLIENT_ID / FREEE_CLIENT_SECRET がありません。環境変数か .env.local に入れてください。",
    );
  }
  return { id, secret };
}

function readTokenCache() {
  if (!fs.existsSync(TOKEN_CACHE)) return null;
  return JSON.parse(fs.readFileSync(TOKEN_CACHE, "utf8"));
}

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

// ── token ────────────────────────────────────────────────────────────

async function tokenRequest(params) {
  const body = new URLSearchParams(params);
  const res = await fetch(`${AUTH_BASE}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = await res.json();
  if (!res.ok)
    fail(`トークン取得に失敗: ${res.status} ${JSON.stringify(json)}`);
  return json;
}

function saveTokens(json) {
  // refresh_token は一度使うと無効になる。必ず新しい値で上書きする
  fs.writeFileSync(
    TOKEN_CACHE,
    JSON.stringify({
      refresh_token: json.refresh_token,
      access_token: json.access_token,
      expires_at: Date.now() + (json.expires_in - 300) * 1000,
    }),
    { mode: 0o600 },
  );
}

async function accessToken() {
  const cached = readTokenCache();
  if (cached?.access_token && cached.expires_at > Date.now()) {
    return cached.access_token;
  }
  const refresh = cached?.refresh_token;
  if (!refresh)
    fail("未認可です。`node scripts/freee.mjs auth-url` から始めてください。");
  const { id, secret } = requireClient();
  const json = await tokenRequest({
    grant_type: "refresh_token",
    client_id: id,
    client_secret: secret,
    refresh_token: refresh,
  });
  saveTokens(json);
  return json.access_token;
}

// ── API ──────────────────────────────────────────────────────────────

async function api(pathname, params = {}, { method = "GET", body } = {}) {
  const token = await accessToken();
  const url = new URL(pathname, API_BASE);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  }
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Api-Version": "2020-06-15",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    // import して使うときは例外で返す。CLI として動くときはそのまま終了する
    const msg = `${res.status} ${url.pathname}: ${JSON.stringify(json)}`;
    if (import.meta.url === `file://${process.argv[1]}`) fail(msg);
    throw new Error(msg);
  }
  return json;
}

/** limit/offset で全件を集める。 */
async function paginate(pathname, params, key, limit = 100) {
  const out = [];
  for (let offset = 0; ; offset += limit) {
    const json = await api(pathname, { ...params, limit, offset });
    const rows = json[key] ?? [];
    out.push(...rows);
    if (rows.length < limit) break;
  }
  return out;
}

function print(obj) {
  process.stdout.write(JSON.stringify(obj, null, 2) + "\n");
}

// ── commands ─────────────────────────────────────────────────────────

const commands = {
  "auth-url": async () => {
    const { id } = requireClient();
    const url = new URL(`${AUTH_BASE}/authorize`);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", id);
    url.searchParams.set("redirect_uri", REDIRECT_URI);
    url.searchParams.set("prompt", "select_company");
    console.log(url.toString());
  },
  auth: async (code) => {
    if (!code) fail("認可コードを渡してください。");
    const { id, secret } = requireClient();
    const json = await tokenRequest({
      grant_type: "authorization_code",
      client_id: id,
      client_secret: secret,
      code,
      redirect_uri: REDIRECT_URI,
    });
    saveTokens(json);
    const companies = await api("/api/1/companies");
    console.log("認可しました。事業所:");
    for (const c of companies.companies ?? [])
      console.log(`  ${c.id}  ${c.display_name}  (${c.role})`);
  },
  companies: async () => print(await api("/api/1/companies")),
  company: async (id) =>
    print(await api(`/api/1/companies/${need(id)}`, { details: true })),
  walletables: async (id) =>
    print(
      await api("/api/1/walletables", {
        company_id: need(id),
        with_balance: true,
      }),
    ),
  "trial-pl": async (id, fy) =>
    print(
      await api("/api/1/reports/trial_pl", {
        company_id: need(id),
        fiscal_year: need(fy),
      }),
    ),
  "trial-bs": async (id, fy) =>
    print(
      await api("/api/1/reports/trial_bs", {
        company_id: need(id),
        fiscal_year: need(fy),
      }),
    ),
  deals: async (id, from, to) =>
    print(
      await paginate(
        "/api/1/deals",
        {
          company_id: need(id),
          start_issue_date: need(from),
          end_issue_date: need(to),
        },
        "deals",
      ),
    ),
  "wallet-txns": async (id, from, to) =>
    print(
      await paginate(
        "/api/1/wallet_txns",
        { company_id: need(id), start_date: need(from), end_date: need(to) },
        "wallet_txns",
      ),
    ),
  "account-items": async (id) =>
    print(await api("/api/1/account_items", { company_id: need(id) })),
  /**
   * 銀行 CSV から作った行（{date, description, out, inn}）を口座明細として登録する。
   * 同期で取れた期間と重ならないよう `--before YYYY-MM-DD` で上限を切る。`--execute` が無ければ dry-run。
   */
  "post-bank-rows": async (companyId, walletableId, file, ...flags) => {
    need(companyId);
    need(walletableId);
    need(file);
    const before = flags.includes("--before")
      ? flags[flags.indexOf("--before") + 1]
      : "9999-12-31";
    const execute = flags.includes("--execute");
    const rows = JSON.parse(fs.readFileSync(file, "utf8"))
      .filter((r) => r.date < before)
      .sort((a, b) => (a.date < b.date ? -1 : 1));
    let inn = 0,
      out = 0;
    for (const r of rows) {
      inn += r.inn || 0;
      out += r.out || 0;
    }
    console.error(
      `${rows.length}件 入金¥${inn.toLocaleString()} 出金¥${out.toLocaleString()} （${rows[0]?.date}〜${rows.at(-1)?.date}）`,
    );
    if (!execute) {
      console.error("dry-run。書くには --execute");
      return;
    }
    let done = 0;
    for (const r of rows) {
      const body = {
        company_id: Number(companyId),
        date: r.date,
        amount: r.inn || r.out,
        entry_side: r.inn ? "income" : "expense",
        walletable_type: "bank_account",
        walletable_id: Number(walletableId),
        description: r.description,
        balance: r.balance,
      };
      await api("/api/1/wallet_txns", {}, { method: "POST", body });
      done += 1;
    }
    console.error(`${done}件を登録しました`);
  },
  get: async (pathname, ...kv) => {
    const params = Object.fromEntries(kv.map((s) => s.split("=")));
    print(await api(need(pathname), params));
  },
};

function need(v) {
  if (v === undefined || v === "")
    fail("引数が足りません。ファイル先頭の使い方を見てください。");
  return v;
}

// 他のスクリプトから `import { api, paginate } from "./freee.mjs"` で使えるようにする
export { api, paginate };

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, ...args] = process.argv.slice(2);
  const fn = commands[cmd];
  if (!fn) {
    console.error(`コマンド: ${Object.keys(commands).join(", ")}`);
    process.exit(1);
  }
  await fn(...args);
}
