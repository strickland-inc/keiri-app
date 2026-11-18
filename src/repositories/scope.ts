/**
 * 会社スコープの判定。InMemory / Sheets の両実体が同じ規則を使う。
 */
import type { CompanyScope } from "./types";

/**
 * レコードが指定された会社スコープに入るか。
 *
 * - スコープ未指定なら全件通す（家計面など、会社をまたぐ集計で使う）
 * - レコードの会社が未設定なら、`includeUnassigned` のときだけ通す。
 *   会社導入前に作られたデータを既定会社の帳簿として扱うための逃げ道で、
 *   既存データを書き換えずに移行できるようにしている
 */
export function matchesCompany(
  recordIssuerId: string | undefined,
  scope: CompanyScope,
): boolean {
  if (!scope.issuerId) return true;
  if (!recordIssuerId) return scope.includeUnassigned === true;
  return recordIssuerId === scope.issuerId;
}

/** 帳票の採番カウンターのキー。会社ごと・帳票種別ごとに独立させる。 */
export function counterKey(issuerId: string, type: string): string {
  return `${issuerId}:${type}`;
}

/**
 * 次の連番。カウンターの値と、実際に発行済みの最大番号の大きい方から進める。
 *
 * カウンターだけを見ないのは2つの理由による。
 * 1. 会社ごとのカウンターは後から導入したため、既存の会社では行がまだ無い。
 *    その場合 stored=0 になるが、発行済みの番号と衝突させてはいけない
 * 2. シートを手で触ってカウンターが実データより遅れることがある
 *
 * この規則は scripts/keiri.mjs の CLI 側にも同じ形で置いてある。
 * 片方だけ変えると、画面と CLI が同じ番号を二重に振る。
 */
export function nextSequence(storedCounter: number, maxIssued: number): number {
  return Math.max(storedCounter, maxIssued, 0) + 1;
}
