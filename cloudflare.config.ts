import fs from "node:fs";
import { bindings, defineConfig, defineWorker } from "cf/config";

/**
 * Cloudflare Workers への配備設定（vinext）。
 *
 * 課金を発生させない方針:
 *  - 使うのは Workers（無料プランの範囲）と静的アセットだけ。KV / D1 / R2 / Images / Queues /
 *    Durable Objects / Browser Run などの課金対象のバインディングは宣言しない。
 *  - 無料プランは上限（CPU 10ms・外部通信 50 回・1 日 10 万リクエスト）を超えるとエラーになるだけで、請求は発生しない。
 */

/** アプリが読む秘密情報の名前。環境変数（process.env）で渡された名前だけをシークレットとして宣言する。 */
const SECRET_NAMES = [
  "APP_LOGIN_ID",
  "APP_LOGIN_PASSWORD",
  "AUTH_SECRET",
  "GOOGLE_SERVICE_ACCOUNT_EMAIL",
  "GOOGLE_PRIVATE_KEY",
  "SHEETS_SPREADSHEET_ID",
  "DOCUMENT_TEMPLATE_SPREADSHEET_ID",
  "DOCUMENT_TEMPLATE_SHEET_ID",
  "DOCUMENT_OUTPUT_FOLDER_ID",
  "GEMINI_API_KEY",
  "ANTHROPIC_API_KEY",
  "TYPESAFE_API_KEY",
  "TYPESAFE_MODEL",
  "AGENT_READ_TOKEN",
  "AGENT_WRITE_TOKEN",
  "AGENT_DOCUMENTS_TOKEN",
  "PUSH_SECRET",
  "VAPID_SUBJECT",
  "VAPID_PUBLIC_KEY",
  "VAPID_PRIVATE_KEY",
] as const;

/** ローカル開発用の .dev.vars に書かれている名前（配備時には無い）。 */
function namesInDevVars(): Set<string> {
  if (!fs.existsSync(".dev.vars")) return new Set();
  return new Set(
    fs
      .readFileSync(".dev.vars", "utf8")
      .split("\n")
      .map((line) => line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/)?.[1])
      .filter((name): name is string => Boolean(name)),
  );
}

const inDevVars = namesInDevVars();
const declared = SECRET_NAMES.filter(
  (name) => process.env[name] || inDevVars.has(name),
);

export default defineConfig({
  worker: defineWorker({
    name: "keiri-app",
    entrypoint: "vinext/server/fetch-handler",
    compatibilityDate: "2026-10-01",
    compatibilityFlags: ["nodejs_compat"],
    assets: { notFoundHandling: "none" },
    env: {
      ASSETS: bindings.assets(),
      ...Object.fromEntries(declared.map((name) => [name, bindings.secret()])),
    },
  }),
});
