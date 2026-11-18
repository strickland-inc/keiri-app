/**
 * Cloudflare Workers へデプロイする。秘密情報は環境変数と .env.local から集めてデプロイに同梱する
 * （両方にあれば環境変数を優先）。値は画面にもログにも出さない（名前だけ表示）。
 * 一時ファイルはデプロイ後に必ず削除する。
 *
 * Cloudflare へのログイン: 先に `npx cf auth login`（ブラウザで承認）。
 * 自動化するときは、代わりに環境変数 CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID を使う。
 * アプリの設定（APP_LOGIN_ID, AUTH_SECRET, GOOGLE_*, TYPESAFE_API_KEY など）は
 * cloudflare.config.ts の SECRET_NAMES にある名前だけが同梱される。
 *
 * 使い方:
 *   node scripts/deploy-cloudflare.mjs            # デプロイ
 *   node scripts/deploy-cloudflare.mjs --dry-run  # 確認だけ（アップロードしない）
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { readEnvLocal } from "./env-local.mjs";

const dryRun = process.argv.includes("--dry-run");

// cloudflare.config.ts の SECRET_NAMES を、ソースから読んで同じ一覧を使う
const configSource = fs.readFileSync("cloudflare.config.ts", "utf8");
const block =
  configSource.match(/const SECRET_NAMES = \[([\s\S]*?)\] as const/)?.[1] ?? "";
const secretNames = [...block.matchAll(/"([A-Z0-9_]+)"/g)].map((m) => m[1]);

const localEnv = readEnvLocal();
/** 環境変数を先に、無ければ .env.local の値を返す。空文字は未設定として扱う。 */
const valueOf = (name) => process.env[name] || localEnv[name] || "";

const present = secretNames.filter((n) => valueOf(n));
const absent = secretNames.filter((n) => !valueOf(n));
console.log(
  `同梱するシークレット (${present.length}): ${present.join(", ") || "なし"}`,
);
if (absent.length > 0)
  console.log(`未設定（同梱しない）: ${absent.join(", ")}`);

if (valueOf("AUTH_SECRET").length < 16) {
  console.warn(
    "\n警告: AUTH_SECRET が未設定か 16 文字未満です。このまま公開すると、アプリはすべてのリクエストを 500 で断ります。",
  );
}

const args = ["cf", "deploy"];
let secretsFile = null;
try {
  if (present.length > 0) {
    secretsFile = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), "cf-secrets-")),
      "secrets.json",
    );
    // JSON 形式なら改行を含む値（秘密鍵）も曖昧さなく渡せる
    const secrets = Object.fromEntries(present.map((n) => [n, valueOf(n)]));
    fs.writeFileSync(secretsFile, JSON.stringify(secrets), { mode: 0o600 });
    args.push("--secrets-file", secretsFile);
  }
  if (dryRun) args.push("--dry-run");
  // cloudflare.config.ts は環境変数にある名前だけをシークレットとして宣言するので、同じ値を子プロセスにも渡す
  const env = {
    ...process.env,
    ...Object.fromEntries(present.map((n) => [n, valueOf(n)])),
  };
  const res = spawnSync("npx", args, { stdio: "inherit", env });
  process.exitCode = res.status ?? 1;
} finally {
  if (secretsFile)
    fs.rmSync(path.dirname(secretsFile), { recursive: true, force: true });
}
