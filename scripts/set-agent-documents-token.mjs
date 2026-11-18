/**
 * 書類作成 API（/api/agent/v1/documents）の合言葉を作り、Worker に登録する。
 * 合言葉は、この端末にだけ 1 回表示する（ログには残さない）。
 *
 * 使い方: node scripts/set-agent-documents-token.mjs [--worker 名前]
 * 前提: `npx wrangler login` 済み、または環境変数 CLOUDFLARE_API_TOKEN がある。
 * Worker の名前の既定は keiri-app（cloudflare.config.ts の name と同じにする）。
 * Cloudflare のアカウントが複数あるときは、環境変数 CLOUDFLARE_ACCOUNT_ID で選ぶ。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const workerName = args.includes("--worker")
  ? args[args.indexOf("--worker") + 1]
  : "keiri-app";
const token = crypto.randomBytes(24).toString("hex"); // 48 文字

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cf-secrets-"));
const file = path.join(dir, "secrets.json");
let status = 1;
try {
  fs.writeFileSync(file, JSON.stringify({ AGENT_DOCUMENTS_TOKEN: token }), {
    mode: 0o600,
  });
  status =
    spawnSync(
      "npx",
      ["--yes", "wrangler", "secret", "bulk", file, "--name", workerName],
      {
        stdio: "inherit",
        env: process.env,
      },
    ).status ?? 1;
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

if (status === 0) {
  console.log(
    "\n=== 書類作成 API の合言葉（この画面にだけ表示。今すぐ控えてください）===",
  );
  console.log(token);
  console.log(
    "====================================================================",
  );
} else {
  console.error(
    "\n登録に失敗しました。`npx wrangler login` 済みか確認してください。",
  );
}
process.exit(status);
