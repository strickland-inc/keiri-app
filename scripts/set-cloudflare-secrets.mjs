/**
 * Cloudflare の Worker（既定の名前は keiri-app）へ、ログイン情報と API キーをまとめて登録する対話スクリプト。
 * 値は「この端末 → Cloudflare」だけを通る（画面に再表示しない・ログに残さない）。
 * 一時ファイルは 0600 で作り、終わったら必ず削除する。
 *
 * 使い方（Node 22+。wrangler は npx が取得する）:
 *   1) Cloudflare にログイン: `npx wrangler login`（または環境変数 CLOUDFLARE_API_TOKEN）
 *   2) node scripts/set-cloudflare-secrets.mjs
 *      --dry-run   登録せず、登録する名前だけ表示
 *      --worker X  Worker 名（既定 keiri-app。cloudflare.config.ts の name と同じにする）
 *   Cloudflare のアカウントが複数あるときは、環境変数 CLOUDFLARE_ACCOUNT_ID で選ぶ。
 *
 * Enter だけで飛ばした項目は登録しない（既存の値はそのまま残る）。
 * APP_LOGIN_PASSWORD を空にすると、20 文字のランダムなパスワードを作って、この端末にだけ 1 回表示する。
 * AUTH_SECRET を空にすると、ランダムな値を作って登録する（表示はしない）。
 * 作り直すと、ログイン中の人は全員ログアウトになる。今の値を残すときは「-」を入れる。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const workerName = args.includes("--worker")
  ? args[args.indexOf("--worker") + 1]
  : "keiri-app";

const FIELDS = [
  {
    name: "APP_LOGIN_ID",
    label: "ログイン ID（管理者）",
    hidden: false,
    fallback: "admin",
  },
  {
    name: "APP_LOGIN_PASSWORD",
    label: "ログインパスワード（空 Enter で自動生成）",
    hidden: true,
    generate: true,
  },
  {
    name: "AUTH_SECRET",
    label:
      "ログインの署名鍵 AUTH_SECRET（空 Enter で自動生成。今の値を残すときは -）",
    hidden: true,
    generateSecret: true,
  },
  {
    name: "TYPESAFE_API_KEY",
    label: "TypeSafe(Jev) API キー（銀行 CSV の仕訳。空 Enter で飛ばす）",
    hidden: true,
  },
  {
    name: "GEMINI_API_KEY",
    label: "Gemini API キー（見積もり・レシート読取。空 Enter で飛ばす）",
    hidden: true,
  },
];

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: process.stdin.isTTY,
});
const muted = { on: false };
const realWrite = rl._writeToOutput?.bind(rl);
if (process.stdin.isTTY && realWrite) {
  rl._writeToOutput = (s) => {
    // 入力中の文字は伏せる（プロンプトと改行だけ出す）
    if (!muted.on || s.includes("\n") || s.includes("\r")) realWrite(s);
  };
}

const queued = process.stdin.isTTY ? null : [];
if (queued) rl.on("line", (l) => queued.push(l));

function ask(label, hidden) {
  if (queued) {
    // 端末ではない入力（パイプ）は、行を順に使う（テスト用）
    return new Promise((resolve) => {
      const tick = () =>
        queued.length ? resolve(queued.shift()) : setTimeout(tick, 10);
      tick();
    });
  }
  return new Promise((resolve) => {
    muted.on = false;
    rl.question(`${label}: `, (answer) => {
      muted.on = false;
      resolve(answer);
    });
    muted.on = hidden;
  });
}

const secrets = {};
let generated = null;
for (const f of FIELDS) {
  let value = (await ask(f.label, f.hidden)).trim();
  if (!value && f.fallback) value = f.fallback;
  if (f.generateSecret && value === "-") continue;
  if (!value && f.generate) {
    value = crypto.randomBytes(15).toString("base64url"); // 20 文字
    generated = value;
  }
  if (!value && f.generateSecret) {
    value = crypto.randomBytes(32).toString("base64url"); // 43 文字
  }
  if (value) secrets[f.name] = value;
}
rl.close();

const names = Object.keys(secrets);
if (names.length === 0) {
  console.log("登録する項目がありません。");
  process.exit(0);
}
if ("APP_LOGIN_PASSWORD" in secrets && secrets.APP_LOGIN_PASSWORD.length < 12) {
  console.error(
    "\nパスワードは 12 文字以上にしてください（再実行してください）。",
  );
  process.exit(1);
}

console.log(
  `\n登録する項目 (${names.length}): ${names.join(", ")}  → Worker「${workerName}」`,
);
if (dryRun) {
  console.log("--dry-run のため、登録しません。");
  process.exit(0);
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cf-secrets-"));
const file = path.join(dir, "secrets.json");
let status = 1;
try {
  fs.writeFileSync(file, JSON.stringify(secrets), { mode: 0o600 });
  const res = spawnSync(
    "npx",
    ["--yes", "wrangler", "secret", "bulk", file, "--name", workerName],
    {
      stdio: "inherit",
      env: process.env,
    },
  );
  status = res.status ?? 1;
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

if (status === 0) {
  console.log(
    "\n登録しました。登録済みの名前は `npx wrangler secret list --name " +
      workerName +
      "` で確認できます。",
  );
  if (generated) {
    console.log(
      "\n=== 自動生成したパスワード（この画面にだけ表示。今すぐ控えてください）===",
    );
    console.log(generated);
    console.log(
      "================================================================",
    );
  }
  console.log(
    "ログイン画面は、デプロイのときに表示された URL の末尾に /login を付けたものです。",
  );
} else {
  console.error(
    "\n登録に失敗しました。`npx wrangler login` 済みか、アカウントが正しいか確認してください。",
  );
}
process.exit(status);
