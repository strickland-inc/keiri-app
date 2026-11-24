/**
 * auth_counters の `fail:` の鍵の寿命の計算。メモリ版とスプレッドシート版で共有する。
 * 鍵は、どれも最後が窓の番号。
 *  - `fail:ip:<userId>:<ip>:<15 分の窓>`  ID と IP の組の、パスワードの試行
 *  - `fail:all:<userId>:<1 時間の窓>`      ID ごとの、パスワードの試行
 *  - `fail:totp:<userId>:<15 分の窓>`      ID ごとの、2段階認証のコードの試行（IP に関係なく数える）
 *  - `fail:pw:<userId>:<15 分の窓>`        ログイン中の、パスワードの再入力の試行
 *  - `fail:log:<userId>:<15 分の窓>`       監査ログに login.failure を残したか（窓ごとに 1 回）
 *  - `fail:unknown:<15 分の窓>`            存在しない ID の試行（窓ごとに 1 行。応答の速さをそろえるため）
 * ip に ":" が入る（IPv6）ので、窓の番号は最後の ":" の後ろから読む。
 */
export const QUARTER_WINDOW_MS = 15 * 60 * 1000;
export const HOUR_WINDOW_MS = 60 * 60 * 1000;
/** 窓が終わってから、これだけ経った鍵は消してよい。 */
export const FAIL_KEY_TTL_MS = 24 * 60 * 60 * 1000;

/** その鍵の窓が終わる時刻（ミリ秒）。`fail:` の鍵でなければ null。 */
export function failKeyWindowEnd(key: string): number | null {
  if (!key.startsWith("fail:")) return null;
  const windowMs = key.startsWith("fail:all:")
    ? HOUR_WINDOW_MS
    : /^fail:(ip|totp|pw|log|unknown):/.test(key)
      ? QUARTER_WINDOW_MS
      : null;
  if (windowMs === null) return null;
  const n = Number(key.slice(key.lastIndexOf(":") + 1));
  if (!Number.isInteger(n) || n < 0) return null;
  return (n + 1) * windowMs;
}

export function isStaleFailKey(key: string, nowMs: number): boolean {
  const end = failKeyWindowEnd(key);
  return end !== null && end + FAIL_KEY_TTL_MS <= nowMs;
}

/** 1 回の掃除で消す行の上限。 */
export const PRUNE_LIMIT = 20;
