import { getSessionSecret } from "@/lib/auth";

/*
 * 本番で AUTH_SECRET が未設定なら、理由を出してプロセスを終了する。
 * 例外を投げるだけだと、Next.js はプロセスを残したまま全リクエストに 500 を返し続ける。
 */
try {
  getSessionSecret();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
