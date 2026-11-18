/**
 * サーバーの起動時に一度だけ呼ばれる。
 * 起動時の検査は Node.js でだけ動かす（process.exit が Edge Runtime に無いため）。
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation-node");
  }
}
