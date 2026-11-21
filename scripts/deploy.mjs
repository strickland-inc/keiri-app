/**
 * Cloudflare Workers へデプロイする。
 *
 * 秘密の値（接続コードと、任意の API キー）は .env.local から読み、デプロイに同梱する。
 * 環境変数にもあれば、環境変数を優先する。値は画面にもログにも出さない（名前だけ表示する）。
 * 同梱に使う一時ファイルは、デプロイのあと必ず消す。
 *
 * 先に `npx cf auth login` で Cloudflare にログインしておく。
 *
 * 使い方:
 *   npm run deploy               # デプロイ
 *   npm run deploy -- --dry-run  # 確認だけ（アップロードしない）
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "..");
const dryRun = process.argv.includes("--dry-run");

/** cloudflare.config.ts の SECRET_NAMES と同じ一覧を、ソースから読む。 */
function readSecretNames() {
  const source = fs.readFileSync(
    path.join(root, "cloudflare.config.ts"),
    "utf8",
  );
  const block =
    source.match(/const SECRET_NAMES = \[([\s\S]*?)\] as const/)?.[1] ?? "";
  return [...block.matchAll(/"([A-Z0-9_]+)"/g)].map((match) => match[1]);
}

/** .env.local の KEY=value を読む。値を囲む "" は外す。ファイルが無ければ空。 */
function readEnvLocal() {
  const file = path.join(root, ".env.local");
  if (!fs.existsSync(file)) return {};
  const env = {};
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) continue;
    const value = match[2].trim();
    env[match[1]] = /^".*"$/.test(value) ? value.slice(1, -1) : value;
  }
  return env;
}

const localEnv = readEnvLocal();
const names = readSecretNames();
const valueOf = (name) => process.env[name] || localEnv[name] || "";
const secrets = Object.fromEntries(
  names.filter(valueOf).map((name) => [name, valueOf(name)]),
);

if (!secrets.KEIRI_CONNECTION?.startsWith("keiri1_")) {
  console.error(
    "KEIRI_CONNECTION が未設定か、形が違います。スプレッドシートのメニュー「keiri-app」で接続コードを発行し、.env.local に入れてください。",
  );
  process.exit(1);
}
console.log(`同梱する値: ${Object.keys(secrets).join(", ")}`);

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "keiri-deploy-"));
const secretsFile = path.join(directory, "secrets.json");
const cleanUp = () => fs.rmSync(directory, { recursive: true, force: true });
// Ctrl-C で止めたときも、秘密の値を書いた一時ファイルを残さない。
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    cleanUp();
    process.exit(130);
  });
}
try {
  fs.writeFileSync(secretsFile, JSON.stringify(secrets), { mode: 0o600 });
  const args = ["cf", "deploy", "--secrets-file", secretsFile];
  if (dryRun) args.push("--dry-run");
  // cloudflare.config.ts は、環境変数にある名前だけを秘密の値として宣言する。
  // 同梱する値と宣言を一致させるため、同梱しない名前は空にして渡す。
  const env = {
    ...process.env,
    ...Object.fromEntries(names.map((name) => [name, secrets[name] ?? ""])),
  };
  const result = spawnSync("npx", args, { cwd: root, stdio: "inherit", env });
  process.exitCode = result.status ?? 1;
} finally {
  cleanUp();
}
