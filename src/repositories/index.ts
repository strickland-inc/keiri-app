/**
 * Repository factory。環境に応じて実体を選ぶ唯一の場所。
 * - Sheets の環境変数が揃っていれば Google Sheets バックエンド
 * - 揃っていなければ InMemory（デモデータ）
 * 商用化で DB に移すときも、ここに分岐を足すだけで UI/API は無改修。
 */
import { hasSheetsConfig } from "@/lib/config";
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
  if (hasSheetsConfig()) {
    const mod = await import("./sheets");
    cached = mod.sheetsRepositories;
  } else {
    globalForMemory.__keiriMemoryRepositories ??= memoryRepositories;
    cached = globalForMemory.__keiriMemoryRepositories;
  }
  return cached;
}
