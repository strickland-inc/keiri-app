/**
 * Repository factory。環境に応じて実体を選ぶ唯一の場所。
 * - 接続コード（KEIRI_CONNECTION）があれば、利用者のスプレッドシート
 * - 無ければ InMemory（デモデータ。保存されない）
 */
import { hasConnection } from "@/lib/gateway";
import { memoryRepositories } from "./memory";
import type { Repositories } from "./types";

let cached: Repositories | null = null;

/**
 * InMemory のデータは globalThis に 1 つだけ持つ。Next.js は API ルートと画面でモジュールを
 * 別々に読み込むため、モジュール変数のままだと API で保存したデータが画面から見えない。
 */
const globalForMemory = globalThis as {
  __keiriMemoryRepositories?: Repositories;
};

export async function getRepositories(): Promise<Repositories> {
  if (cached) return cached;
  if (hasConnection()) {
    const mod = await import("./sheets");
    cached = mod.sheetsRepositories;
  } else {
    globalForMemory.__keiriMemoryRepositories ??= memoryRepositories;
    cached = globalForMemory.__keiriMemoryRepositories;
  }
  return cached;
}
