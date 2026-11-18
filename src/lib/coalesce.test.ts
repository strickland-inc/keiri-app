import assert from "node:assert/strict";
import test from "node:test";
import { createCoalescedFetcher } from "./coalesce.ts";

function makeFetcher() {
  const calls: string[][] = [];
  const fetcher = createCoalescedFetcher<string[]>(
    async (names) => {
      calls.push([...names]);
      return new Map(names.map((n) => [n, [`${n}-1`, `${n}-2`]]));
    },
    (value) => [...value],
  );
  return { calls, fetcher };
}

test("同じ瞬間の取得は 1 回にまとまる", async () => {
  const { calls, fetcher } = makeFetcher();
  const [a, b, c] = await Promise.all([
    fetcher("documents"),
    fetcher("parties"),
    fetcher("expenses"),
  ]);
  assert.equal(calls.length, 1, "通信は 1 回");
  assert.deepEqual(calls[0].sort(), ["documents", "expenses", "parties"]);
  assert.deepEqual(a, ["documents-1", "documents-2"]);
  assert.deepEqual(b, ["parties-1", "parties-2"]);
  assert.deepEqual(c, ["expenses-1", "expenses-2"]);
});

test("同じ名前は 1 回だけ取得し、呼び出し元ごとにコピーを返す", async () => {
  const { calls, fetcher } = makeFetcher();
  const [x, y] = await Promise.all([
    fetcher("documents"),
    fetcher("documents"),
  ]);
  assert.deepEqual(calls, [["documents"]]);
  x.push("変更");
  assert.deepEqual(
    y,
    ["documents-1", "documents-2"],
    "片方の変更がもう片方に影響しない",
  );
});

test("時間をあけた取得は、別々の通信になる", async () => {
  const { calls, fetcher } = makeFetcher();
  await fetcher("documents");
  await fetcher("parties");
  assert.equal(calls.length, 2);
});

test("通信が失敗したら、まとめた全員が同じエラーを受け取る", async () => {
  const fetcher = createCoalescedFetcher<string>(async () => {
    throw new Error("Google API エラー (429)");
  });
  const results = await Promise.allSettled([fetcher("a"), fetcher("b")]);
  assert.deepEqual(
    results.map((r) => r.status),
    ["rejected", "rejected"],
  );
  assert.match(String((results[0] as PromiseRejectedResult).reason), /429/);
});

test("結果に無い名前だけが失敗し、他は成功する", async () => {
  const fetcher = createCoalescedFetcher<string>(
    async () => new Map([["a", "A"]]),
  );
  const [a, b] = await Promise.allSettled([fetcher("a"), fetcher("b")]);
  assert.equal(a.status, "fulfilled");
  assert.equal(b.status, "rejected");
});
