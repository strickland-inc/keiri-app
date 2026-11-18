import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  authSecretProblem,
  authSecretRejection,
  createSession,
  getSessionSecret,
  verifySession,
} from "./auth.ts";

const original = {
  AUTH_SECRET: process.env.AUTH_SECRET,
  NODE_ENV: process.env.NODE_ENV,
};

// NODE_ENV は型の上で読み取り専用なので、書き換えられる形として扱う
const env = process.env as Record<string, string | undefined>;

function setEnv(key: keyof typeof original, value: string | undefined): void {
  if (value === undefined) delete env[key];
  else env[key] = value;
}

afterEach(() => {
  setEnv("AUTH_SECRET", original.AUTH_SECRET);
  setEnv("NODE_ENV", original.NODE_ENV);
});

test("本番で AUTH_SECRET が未設定なら止める", () => {
  setEnv("NODE_ENV", "production");
  setEnv("AUTH_SECRET", undefined);
  assert.match(authSecretProblem() ?? "", /AUTH_SECRET/);
  assert.throws(() => getSessionSecret(), /AUTH_SECRET/);
  setEnv("AUTH_SECRET", "");
  assert.throws(() => getSessionSecret(), /AUTH_SECRET/);
});

test("本番で AUTH_SECRET が未設定なら、proxy が返す応答は 500", async () => {
  setEnv("NODE_ENV", "production");
  setEnv("AUTH_SECRET", undefined);
  const res = authSecretRejection();
  assert.equal(res?.status, 500);
  assert.match((await res?.text()) ?? "", /AUTH_SECRET/);

  setEnv("AUTH_SECRET", "a".repeat(32));
  assert.equal(authSecretRejection(), null);
});

test("開発中は AUTH_SECRET が無くても断らない", () => {
  setEnv("NODE_ENV", "development");
  setEnv("AUTH_SECRET", undefined);
  assert.equal(authSecretRejection(), null);
});

test("本番で AUTH_SECRET が 16 文字未満なら止める", () => {
  setEnv("NODE_ENV", "production");
  setEnv("AUTH_SECRET", "a".repeat(15));
  assert.match(authSecretProblem() ?? "", /短すぎます/);
  assert.throws(() => getSessionSecret(), /AUTH_SECRET/);
  setEnv("AUTH_SECRET", "a".repeat(16));
  assert.equal(authSecretProblem(), null);
});

test("本番で AUTH_SECRET が未設定なら、ログインの Cookie を作らず、どの Cookie も通さない", async () => {
  setEnv("NODE_ENV", "production");
  setEnv("AUTH_SECRET", "a".repeat(32));
  const token = await createSession("user-1");

  setEnv("AUTH_SECRET", undefined);
  await assert.rejects(() => createSession("user-1"), /AUTH_SECRET/);
  assert.equal(await verifySession(token), null);
});

test("開発中は未設定でも固定値で動く", () => {
  setEnv("NODE_ENV", "development");
  setEnv("AUTH_SECRET", undefined);
  assert.equal(authSecretProblem(), null);
  assert.ok(getSessionSecret().length > 0);
});

test("別の AUTH_SECRET で作った Cookie は通さない", async () => {
  setEnv("NODE_ENV", "production");
  setEnv("AUTH_SECRET", "a".repeat(32));
  const token = await createSession("user-1");
  assert.deepEqual(await verifySession(token), { sub: "user-1", role: "user" });
  setEnv("AUTH_SECRET", "b".repeat(32));
  assert.equal(await verifySession(token), null);
});
