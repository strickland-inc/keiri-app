/**
 * 同じタイミングで出された「名前つきの取得」を 1 回の一括取得にまとめる。
 *
 * 例: ホームは 書類・取引先・経費・設定・銀行明細 を `Promise.all` で同時に読む。
 * 1 つずつスプレッドシートを読むと 5 回の通信になり、1 回ごとに待ち時間がかかる。
 * そこで、同じ瞬間に出た読み取りを、スプレッドシート側の窓口への 1 回の `read` にまとめる。
 *
 * - まとめる範囲は「同じ瞬間（次のタイマーまで）」。時間をあけた呼び出しは別の取得になる。
 * - 同じ名前を複数の呼び出し元が求めたら、1 回だけ取得して、それぞれにコピーを返す。
 */
export function createCoalescedFetcher<T>(
  fetchMany: (names: string[]) => Promise<ReadonlyMap<string, T>>,
  copy: (value: T) => T = (value) => value,
): (name: string) => Promise<T> {
  interface Waiter {
    resolve: (value: T) => void;
    reject: (reason: unknown) => void;
  }
  let pending = new Map<string, Waiter[]>();
  let scheduled = false;

  async function flush(): Promise<void> {
    const batch = pending;
    pending = new Map();
    scheduled = false;

    const waiters = [...batch.values()].flat();
    try {
      const results = await fetchMany([...batch.keys()]);
      for (const [name, group] of batch) {
        if (!results.has(name)) {
          const missing = new Error(`取得結果に ${name} がありません`);
          for (const w of group) w.reject(missing);
          continue;
        }
        const value = results.get(name) as T;
        for (const w of group) w.resolve(copy(value));
      }
    } catch (e: unknown) {
      for (const w of waiters) w.reject(e);
    }
  }

  return (name) =>
    new Promise<T>((resolve, reject) => {
      const group = pending.get(name) ?? [];
      group.push({ resolve, reject });
      pending.set(name, group);
      if (!scheduled) {
        scheduled = true;
        setTimeout(flush, 0);
      }
    });
}
