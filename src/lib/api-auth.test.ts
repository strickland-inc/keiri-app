import assert from "node:assert/strict";
import test from "node:test";
import type { ApiToken } from "../domain/api-token.ts";
import {
  authenticateApi,
  authorizeApi,
  generateApiToken,
  hashApiToken,
  unauthorized,
} from "./api-auth.ts";

/** list の呼び出し回数を数える、API トークンだけの Repository。 */
function reposWith(tokens: ApiToken[]) {
  const state = { listCalls: 0 };
  const repos = {
    apiTokens: {
      async list() {
        state.listCalls++;
        return tokens;
      },
      async create(): Promise<ApiToken> {
        throw new Error("使わない");
      },
      async remove() {
        throw new Error("使わない");
      },
    },
  };
  return { repos, state };
}

async function storedToken(token: string): Promise<ApiToken> {
  return {
    id: "token-1",
    name: "テスト用",
    tokenHash: await hashApiToken(token),
    createdAt: "2026-11-01T00:00:00.000Z",
  };
}

function requestWith(authorization?: string): Request {
  return new Request("https://keiri.example.test/api/v1/documents", {
    headers: authorization === undefined ? {} : { authorization },
  });
}

test("generateApiToken は keiri_ と 43 文字で、毎回違う", () => {
  const tokens = Array.from({ length: 20 }, generateApiToken);
  for (const token of tokens) {
    assert.match(token, /^keiri_[A-Za-z0-9_-]{43}$/);
  }
  assert.equal(new Set(tokens).size, tokens.length);
});

test("hashApiToken は同じ入力に同じ 64 桁の 16 進数を返す", async () => {
  const a = await hashApiToken("keiri_sample");
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.equal(await hashApiToken("keiri_sample"), a);
  assert.notEqual(await hashApiToken("keiri_other"), a);
});

test("発行済みのトークンは通る", async () => {
  const token = generateApiToken();
  const { repos } = reposWith([await storedToken(token)]);
  assert.equal(await authorizeApi(requestWith(`Bearer ${token}`), repos), true);
});

test("Authorization ヘッダーがなければ通さず、一覧も読まない", async () => {
  const { repos, state } = reposWith([]);
  assert.equal(await authorizeApi(requestWith(), repos), false);
  assert.equal(state.listCalls, 0);
});

test("Bearer でないヘッダーは通さず、一覧も読まない", async () => {
  const token = generateApiToken();
  const { repos, state } = reposWith([await storedToken(token)]);
  for (const header of [`Basic ${token}`, token, `bearer ${token}`]) {
    assert.equal(await authorizeApi(requestWith(header), repos), false, header);
  }
  assert.equal(state.listCalls, 0);
});

test("形の違うトークンは通さず、一覧も読まない", async () => {
  const { repos, state } = reposWith([]);
  const valid = generateApiToken();
  for (const bad of [
    "",
    "keiri_short",
    valid.slice(0, -1),
    `${valid}x`,
    `other_${valid.slice("keiri_".length)}`,
    `keiri_${"a".repeat(42)}!`,
  ]) {
    assert.equal(
      await authorizeApi(requestWith(`Bearer ${bad}`), repos),
      false,
      bad,
    );
  }
  assert.equal(state.listCalls, 0);
});

test("未発行のトークンは、一覧を読んだうえで通さない", async () => {
  const issued = generateApiToken();
  const { repos, state } = reposWith([await storedToken(issued)]);
  const notIssued = generateApiToken();
  assert.equal(
    await authorizeApi(requestWith(`Bearer ${notIssued}`), repos),
    false,
  );
  assert.equal(state.listCalls, 1);
});

test("authenticateApi は合ったトークンの id と名前を返す", async () => {
  const token = generateApiToken();
  const other = generateApiToken();
  const { repos } = reposWith([
    { ...(await storedToken(other)), id: "token-0", name: "別のトークン" },
    await storedToken(token),
  ]);
  assert.deepEqual(
    await authenticateApi(requestWith(`Bearer ${token}`), repos),
    { id: "token-1", name: "テスト用" },
  );
});

test("authenticateApi は合わないトークンに null を返し、ハッシュは返さない", async () => {
  const token = generateApiToken();
  const { repos } = reposWith([await storedToken(token)]);
  assert.equal(
    await authenticateApi(requestWith(`Bearer ${generateApiToken()}`), repos),
    null,
  );
  assert.equal(await authenticateApi(requestWith(), repos), null);
  const ok = await authenticateApi(requestWith(`Bearer ${token}`), repos);
  assert.deepEqual(Object.keys(ok ?? {}).sort(), ["id", "name"]);
});

test("unauthorized は 401 を返す", async () => {
  const res = unauthorized();
  assert.equal(res.status, 401);
  assert.deepEqual(await res.json(), { ok: false, error: "unauthorized" });
});
