import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import {
  PENDING_MAX_AGE,
  SESSION_MAX_AGE,
  connectionCodeMatches,
  createPending,
  isDemoAuth,
  verifyPending,
  connectionProblem,
  connectionRejection,
  createSession,
  getSessionSecret,
  isDemoMode,
  verifySession,
} from "./auth.ts";

const original = {
  KEIRI_CONNECTION: process.env.KEIRI_CONNECTION,
  NODE_ENV: process.env.NODE_ENV,
  KEIRI_DEMO_AUTH: process.env.KEIRI_DEMO_AUTH,
};

// NODE_ENV は型の上で読み取り専用なので、書き換えられる形として扱う
const env = process.env as Record<string, string | undefined>;

function setEnv(key: keyof typeof original, value: string | undefined): void {
  if (value === undefined) delete env[key];
  else env[key] = value;
}

function connectionCode(keySeed: string): string {
  const payload = {
    u: "https://script.google.com/macros/s/AKfycbTEST_id-1/exec",
    k: keySeed.repeat(32),
    s: "1AbCdEfGhIjKlMnOpQrStUv",
  };
  return `keiri1_${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;
}

const CODE_A = connectionCode("a");
const CODE_B = connectionCode("b");

/** 署名は正しい形で、中身だけが違うトークン。 */
const WELL_FORMED_TOKEN = `${Buffer.from(
  JSON.stringify({ sub: "user-1", role: "admin", exp: Date.now() + 1e9 }),
).toString("base64url")}.${"x".repeat(43)}`;

afterEach(() => {
  mock.restoreAll();
  setEnv("KEIRI_CONNECTION", original.KEIRI_CONNECTION);
  setEnv("NODE_ENV", original.NODE_ENV);
  setEnv("KEIRI_DEMO_AUTH", original.KEIRI_DEMO_AUTH);
});

test("本番で接続コードが未設定・空・形違いなら、理由を返す", () => {
  setEnv("NODE_ENV", "production");
  for (const value of [undefined, "", "keiri1_壊れている", "でたらめ"]) {
    setEnv("KEIRI_CONNECTION", value);
    assert.match(connectionProblem() ?? "", /KEIRI_CONNECTION/, String(value));
  }
});

test("本番で接続コードが未設定なら、proxy が返す応答は 500", async () => {
  setEnv("NODE_ENV", "production");
  for (const value of [undefined, "", "keiri1_壊れている"]) {
    setEnv("KEIRI_CONNECTION", value);
    const res = connectionRejection();
    assert.equal(res?.status, 500, String(value));
    assert.match((await res?.text()) ?? "", /KEIRI_CONNECTION/);
  }
});

test("本番でも接続コードが正しければ断らない", () => {
  setEnv("NODE_ENV", "production");
  setEnv("KEIRI_CONNECTION", CODE_A);
  assert.equal(connectionProblem(), null);
  assert.equal(connectionRejection(), null);
});

test("本番で接続コードに問題があれば、署名の秘密を取り出せない", () => {
  setEnv("NODE_ENV", "production");
  for (const value of [undefined, "", "keiri1_壊れている"]) {
    setEnv("KEIRI_CONNECTION", value);
    assert.throws(() => getSessionSecret(), /KEIRI_CONNECTION/, String(value));
  }
});

test("本番で接続コードに問題があれば、ログインの Cookie を作らず、どの Cookie も通さない", async () => {
  setEnv("NODE_ENV", "production");
  setEnv("KEIRI_CONNECTION", CODE_A);
  const token = await createSession("user-1");
  assert.deepEqual(await verifySession(token), {
    sub: "user-1",
    role: "user",
    sv: "0.0",
  });

  for (const value of [undefined, "", "keiri1_壊れている"]) {
    setEnv("KEIRI_CONNECTION", value);
    await assert.rejects(() => createSession("user-1"), /KEIRI_CONNECTION/);
    assert.equal(await verifySession(token), null, String(value));
    assert.equal(await verifySession(WELL_FORMED_TOKEN), null, String(value));
    assert.equal(await verifySession(undefined), null, String(value));
  }
});

test("本番以外で接続コードが未設定ならデモで、管理者として扱う", async () => {
  setEnv("NODE_ENV", "development");
  setEnv("KEIRI_CONNECTION", undefined);
  assert.equal(isDemoMode(), true);
  assert.equal(connectionProblem(), null);
  assert.equal(connectionRejection(), null);
  assert.ok(getSessionSecret().length > 0);
  assert.deepEqual(await verifySession(undefined), {
    sub: "demo",
    role: "admin",
    sv: "0.0",
  });
});

test("本番では、接続コードが無くても決してデモにならない", async () => {
  setEnv("NODE_ENV", "production");
  for (const value of [undefined, "", "keiri1_壊れている"]) {
    setEnv("KEIRI_CONNECTION", value);
    assert.equal(isDemoMode(), false, String(value));
    assert.equal(await verifySession(undefined), null, String(value));
  }
});

test("接続コードがあれば、本番以外でもデモにならない", async () => {
  setEnv("NODE_ENV", "development");
  setEnv("KEIRI_CONNECTION", CODE_A);
  assert.equal(isDemoMode(), false);
  assert.equal(await verifySession(undefined), null);

  setEnv("KEIRI_CONNECTION", "keiri1_壊れている");
  assert.equal(isDemoMode(), false);
  assert.equal(await verifySession(undefined), null);
});

test("createSession と verifySession が往復する", async () => {
  setEnv("NODE_ENV", "production");
  setEnv("KEIRI_CONNECTION", CODE_A);
  const admin = await createSession("admin-1", "admin");
  assert.deepEqual(await verifySession(admin), {
    sub: "admin-1",
    role: "admin",
    sv: "0.0",
  });
  const user = await createSession("user-1");
  assert.deepEqual(await verifySession(user), {
    sub: "user-1",
    role: "user",
    sv: "0.0",
  });
});

test("トークンがない、形が違う、空のときは null", async () => {
  setEnv("NODE_ENV", "production");
  setEnv("KEIRI_CONNECTION", CODE_A);
  for (const token of [undefined, "", "ドット無し", "a.", ".b"]) {
    assert.equal(await verifySession(token), null, String(token));
  }
});

test("改ざんしたトークンは null", async () => {
  setEnv("NODE_ENV", "production");
  setEnv("KEIRI_CONNECTION", CODE_A);
  const token = await createSession("user-1");
  const [payload, sig] = token.split(".");

  const forged = Buffer.from(
    JSON.stringify({
      ...JSON.parse(Buffer.from(payload, "base64url").toString()),
      role: "admin",
    }),
  ).toString("base64url");
  assert.equal(await verifySession(`${forged}.${sig}`), null);

  const flipped = sig.startsWith("A") ? `B${sig.slice(1)}` : `A${sig.slice(1)}`;
  assert.equal(await verifySession(`${payload}.${flipped}`), null);
  assert.equal(await verifySession(`${payload}.`), null);
});

test("期限切れのトークンは null", async () => {
  setEnv("NODE_ENV", "production");
  setEnv("KEIRI_CONNECTION", CODE_A);
  const start = Date.now();
  const nowMock = mock.method(Date, "now", () => start);
  const token = await createSession("user-1");

  nowMock.mock.mockImplementation(() => start + (SESSION_MAX_AGE - 60) * 1000);
  assert.deepEqual(await verifySession(token), {
    sub: "user-1",
    role: "user",
    sv: "0.0",
  });

  nowMock.mock.mockImplementation(() => start + (SESSION_MAX_AGE + 60) * 1000);
  assert.equal(await verifySession(token), null);
});

test("別の接続コードで署名したトークンは null", async () => {
  setEnv("NODE_ENV", "production");
  setEnv("KEIRI_CONNECTION", CODE_A);
  const token = await createSession("user-1");

  setEnv("KEIRI_CONNECTION", CODE_B);
  assert.equal(await verifySession(token), null);

  setEnv("KEIRI_CONNECTION", CODE_A);
  assert.deepEqual(await verifySession(token), {
    sub: "user-1",
    role: "user",
    sv: "0.0",
  });
});

/** 古い Cookie（sv の無い payload）を、正しい署名で作る。 */
async function legacyToken(secretCode: string): Promise<string> {
  setEnv("NODE_ENV", "production");
  setEnv("KEIRI_CONNECTION", secretCode);
  const token = await createSession("user-1", "admin", "3.4");
  const [payload, sig] = token.split(".");
  const data = JSON.parse(Buffer.from(payload, "base64url").toString());
  delete data.sv;
  const legacyPayload = Buffer.from(JSON.stringify(data)).toString("base64url");
  // 署名は、payload を差し替えたものに付け直す必要がある。getSessionSecret と同じ鍵で HMAC を取る
  const { createHmac } = await import("node:crypto");
  const legacySig = createHmac("sha256", getSessionSecret())
    .update(legacyPayload)
    .digest("base64url");
  assert.notEqual(sig, legacySig);
  return `${legacyPayload}.${legacySig}`;
}

test("sv が往復する", async () => {
  setEnv("NODE_ENV", "production");
  setEnv("KEIRI_CONNECTION", CODE_A);
  const token = await createSession("user-1", "admin", "2.5");
  assert.deepEqual(await verifySession(token), {
    sub: "user-1",
    role: "admin",
    sv: "2.5",
  });
});

test("sv の無い古い Cookie は 0.0 として通る", async () => {
  const token = await legacyToken(CODE_A);
  assert.deepEqual(await verifySession(token), {
    sub: "user-1",
    role: "admin",
    sv: "0.0",
  });
});

test("保留 Cookie は、保留としては通るが、セッションとしては通らない", async () => {
  setEnv("NODE_ENV", "production");
  setEnv("KEIRI_CONNECTION", CODE_A);
  const pending = await createPending("user-1", "totp", "1.2");
  assert.deepEqual(await verifyPending(pending, "totp"), {
    sub: "user-1",
    sv: "1.2",
  });
  // purpose が違う保留は通らない
  assert.equal(await verifyPending(pending, "enroll"), null);
  // 保留 Cookie の値をセッションの Cookie に入れ替えても通らない（鍵が別）
  assert.equal(await verifySession(pending), null);
});

test("セッションの Cookie を保留として出しても通らない", async () => {
  setEnv("NODE_ENV", "production");
  setEnv("KEIRI_CONNECTION", CODE_A);
  const session = await createSession("user-1", "admin", "0.0");
  assert.equal(await verifyPending(session, "totp"), null);
  assert.equal(await verifyPending(session, "enroll"), null);
});

test("purpose 入りの payload は、セッションの鍵で署名されていても verifySession が拒否する", async () => {
  setEnv("NODE_ENV", "production");
  setEnv("KEIRI_CONNECTION", CODE_A);
  const payload = Buffer.from(
    JSON.stringify({
      sub: "user-1",
      purpose: "totp",
      sv: "0.0",
      exp: Date.now() + 1e9,
    }),
  ).toString("base64url");
  const { createHmac } = await import("node:crypto");
  const sig = createHmac("sha256", getSessionSecret())
    .update(payload)
    .digest("base64url");
  assert.equal(await verifySession(`${payload}.${sig}`), null);
});

test("保留 Cookie は 5 分で切れ、別の接続コードでは通らない", async () => {
  setEnv("NODE_ENV", "production");
  setEnv("KEIRI_CONNECTION", CODE_A);
  const start = Date.now();
  const nowMock = mock.method(Date, "now", () => start);
  const pending = await createPending("user-1", "enroll", "0.0");
  nowMock.mock.mockImplementation(() => start + (PENDING_MAX_AGE - 5) * 1000);
  assert.ok(await verifyPending(pending, "enroll"));
  nowMock.mock.mockImplementation(() => start + (PENDING_MAX_AGE + 5) * 1000);
  assert.equal(await verifyPending(pending, "enroll"), null);
  nowMock.mock.mockImplementation(() => start);
  setEnv("KEIRI_CONNECTION", CODE_B);
  assert.equal(await verifyPending(pending, "enroll"), null);
});

test("試用モード（KEIRI_DEMO_AUTH=1）は、本番以外で接続コードが無いときだけ有効で、デモの自動ログインはしない", async () => {
  setEnv("NODE_ENV", "development");
  setEnv("KEIRI_CONNECTION", undefined);
  setEnv("KEIRI_DEMO_AUTH", "1");
  assert.equal(isDemoAuth(), true);
  assert.equal(isDemoMode(), false);
  assert.equal(await verifySession(undefined), null);
  assert.equal(connectionCodeMatches("demo"), true);
  assert.equal(connectionCodeMatches(" demo "), true);
  assert.equal(connectionCodeMatches("DEMO"), false);
  assert.equal(connectionCodeMatches(""), false);
  // 署名の往復はできる（デモの鍵）
  const token = await createSession("user-1", "admin", "1.1");
  assert.deepEqual(await verifySession(token), {
    sub: "user-1",
    role: "admin",
    sv: "1.1",
  });
});

test("KEIRI_DEMO_AUTH が 1 以外なら試用モードにならず、従来のデモのまま", () => {
  setEnv("NODE_ENV", "development");
  setEnv("KEIRI_CONNECTION", undefined);
  for (const value of [undefined, "", "0", "true", "yes"]) {
    setEnv("KEIRI_DEMO_AUTH", value);
    assert.equal(isDemoAuth(), false, String(value));
    assert.equal(isDemoMode(), true, String(value));
    assert.equal(connectionCodeMatches("demo"), false, String(value));
  }
});

test("本番では KEIRI_DEMO_AUTH=1 でも、試用モードにもデモにもならず、demo は接続コードとして通らない", async () => {
  setEnv("KEIRI_DEMO_AUTH", "1");
  for (const connection of [undefined, "", "keiri1_壊れている", CODE_A]) {
    setEnv("NODE_ENV", "production");
    setEnv("KEIRI_CONNECTION", connection);
    assert.equal(isDemoAuth(), false, String(connection));
    assert.equal(isDemoMode(), false, String(connection));
    assert.equal(connectionCodeMatches("demo"), false, String(connection));
    assert.equal(await verifySession(undefined), null, String(connection));
  }
});

test("接続コードがあれば、本番以外でも KEIRI_DEMO_AUTH は効かない", () => {
  setEnv("NODE_ENV", "development");
  setEnv("KEIRI_DEMO_AUTH", "1");
  setEnv("KEIRI_CONNECTION", CODE_A);
  assert.equal(isDemoAuth(), false);
  assert.equal(connectionCodeMatches("demo"), false);
  assert.equal(connectionCodeMatches(CODE_A), true);
  assert.equal(connectionCodeMatches(`${CODE_A}x`), false);
  assert.equal(connectionCodeMatches(CODE_B), false);
});
