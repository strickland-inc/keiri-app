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

/**
 * アプリが読む秘密の値の名前。必須は接続コード（KEIRI_CONNECTION）だけで、残りは任意（パスワードの反復回数と API キー）。
 * 値のある名前だけを宣言する。値は、環境変数、.env.local（ビルドのときに読み込まれる）、
 * .dev.vars（ローカルで Workers として動かすとき）のどれかにあればよい。
 */
const SECRET_NAMES = [
  "KEIRI_CONNECTION",
  "KEIRI_PASSWORD_ITERATIONS",
  "GEMINI_API_KEY",
  "TYPESAFE_API_KEY",
  "TYPESAFE_MODEL",
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
