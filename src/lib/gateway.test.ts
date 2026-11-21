import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  GatewayError,
  callGateway,
  getConnection,
  parseConnectionCode,
  setGatewayTransport,
} from "./gateway.ts";

const URL_OK = "https://script.google.com/macros/s/AKfycbTEST_id-1/exec";
const KEY = "k".repeat(32);
const SHEET_ID = "1AbCdEfGhIjKlMnOpQrStUv";

const originalConnection = process.env.KEIRI_CONNECTION;

function encode(text: string): string {
  return Buffer.from(text, "utf8").toString("base64url");
}

function codeOf(data: unknown): string {
  return `keiri1_${encode(JSON.stringify(data))}`;
}

const VALID = { u: URL_OK, k: KEY, s: SHEET_ID };

afterEach(() => {
  setGatewayTransport(null);
  if (originalConnection === undefined) delete process.env.KEIRI_CONNECTION;
  else process.env.KEIRI_CONNECTION = originalConnection;
});

test("正しい接続コードを接続先・鍵・スプレッドシート ID に分ける", () => {
  assert.deepEqual(parseConnectionCode(codeOf(VALID)), {
    url: URL_OK,
    key: KEY,
    spreadsheetId: SHEET_ID,
  });
});

test("接続コードの前後の空白と改行を無視する", () => {
  assert.deepEqual(parseConnectionCode(`  \n${codeOf(VALID)}\n `), {
    url: URL_OK,
    key: KEY,
    spreadsheetId: SHEET_ID,
  });
});

test("形の違う接続コードは null", () => {
  const cases: Record<string, string> = {
    接頭辞が違う: `keiri2_${encode(JSON.stringify(VALID))}`,
    接頭辞がない: encode(JSON.stringify(VALID)),
    base64が壊れている: "keiri1_!!!***###",
    JSONでない: `keiri1_${encode("これは JSON ではない")}`,
    JSONがオブジェクトでない: codeOf("文字列"),
    nullのJSON: codeOf(null),
    URLがscriptgooglecomでない: codeOf({
      ...VALID,
      u: "https://example.com/macros/s/AKfycbTEST/exec",
    }),
    URLがexecで終わらない: codeOf({
      ...VALID,
      u: "https://script.google.com/macros/s/AKfycbTEST/dev",
    }),
    URLがhttpである: codeOf({
      ...VALID,
      u: "http://script.google.com/macros/s/AKfycbTEST/exec",
    }),
    鍵が短い: codeOf({ ...VALID, k: "k".repeat(31) }),
    鍵が文字列でない: codeOf({ ...VALID, k: 12345 }),
    sがない: codeOf({ u: URL_OK, k: KEY }),
    sが短い: codeOf({ ...VALID, s: "short" }),
  };
  for (const [name, code] of Object.entries(cases)) {
    assert.equal(parseConnectionCode(code), null, name);
  }
});

test("getConnection は未設定なら null、空文字も未設定として扱う", () => {
  delete process.env.KEIRI_CONNECTION;
  assert.equal(getConnection(), null);
  process.env.KEIRI_CONNECTION = "";
  assert.equal(getConnection(), null);
});

test("getConnection は形が違えば日本語のメッセージで例外にする", () => {
  process.env.KEIRI_CONNECTION = "keiri1_壊れている";
  assert.throws(() => getConnection(), /KEIRI_CONNECTION の形が違います/);
});

test("getConnection は正しい接続コードを返す", () => {
  process.env.KEIRI_CONNECTION = codeOf(VALID);
  assert.equal(getConnection()?.key, KEY);
});

test("callGateway は鍵と calls を JSON で送り、results を返す", async () => {
  process.env.KEIRI_CONNECTION = codeOf(VALID);
  const sent: Array<{ url: string; body: string }> = [];
  setGatewayTransport(async (connection, body) => {
    sent.push({ url: connection.url, body });
    return JSON.stringify({ ok: true, v: 1, results: [{ n: 1 }, { n: 2 }] });
  });
  const results = await callGateway([
    { op: "info" },
    { op: "read", tabs: ["documents"] },
  ]);
  assert.deepEqual(results, [{ n: 1 }, { n: 2 }]);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, URL_OK);
  assert.deepEqual(JSON.parse(sent[0].body), {
    key: KEY,
    calls: [{ op: "info" }, { op: "read", tabs: ["documents"] }],
  });
});

test("窓口の ok:false は GatewayError にして code と文面を保つ", async () => {
  process.env.KEIRI_CONNECTION = codeOf(VALID);
  setGatewayTransport(async () =>
    JSON.stringify({
      ok: false,
      error: { code: "unauthorized", message: "接続コードが違います" },
    }),
  );
  await assert.rejects(
    () => callGateway([{ op: "info" }]),
    (error: unknown) => {
      assert.ok(error instanceof GatewayError);
      assert.equal(error.code, "unauthorized");
      assert.equal(error.message, "接続コードが違います");
      return true;
    },
  );
});

test("ok:false で code が無ければ internal にする", async () => {
  process.env.KEIRI_CONNECTION = codeOf(VALID);
  setGatewayTransport(async () => JSON.stringify({ ok: false }));
  await assert.rejects(
    () => callGateway([{ op: "info" }]),
    (error: unknown) =>
      error instanceof GatewayError && error.code === "internal",
  );
});

test("JSON でない応答（HTML）は unreachable", async () => {
  process.env.KEIRI_CONNECTION = codeOf(VALID);
  setGatewayTransport(
    async () => "<!DOCTYPE html><html>ログインしてください</html>",
  );
  await assert.rejects(
    () => callGateway([{ op: "info" }]),
    (error: unknown) => {
      assert.ok(error instanceof GatewayError);
      assert.equal(error.code, "unreachable");
      assert.match(error.message, /アクセスできるユーザー/);
      return true;
    },
  );
});

test("通信の例外は unreachable にして、元のメッセージを残す", async () => {
  process.env.KEIRI_CONNECTION = codeOf(VALID);
  setGatewayTransport(async () => {
    throw new Error("接続が切れました");
  });
  await assert.rejects(
    () => callGateway([{ op: "info" }]),
    (error: unknown) => {
      assert.ok(error instanceof GatewayError);
      assert.equal(error.code, "unreachable");
      assert.match(error.message, /接続が切れました/);
      return true;
    },
  );
});

test("接続コードが未設定なら通信せずに not_configured", async () => {
  delete process.env.KEIRI_CONNECTION;
  let called = false;
  setGatewayTransport(async () => {
    called = true;
    return "{}";
  });
  await assert.rejects(
    () => callGateway([{ op: "info" }]),
    (error: unknown) =>
      error instanceof GatewayError && error.code === "not_configured",
  );
  assert.equal(called, false);
});
