import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  decryptSecret,
  encryptSecret,
  recoveryCodeHmac,
  sha256Hex,
} from "./secret-box.ts";

const env = process.env as Record<string, string | undefined>;
const original = env.KEIRI_CONNECTION;

function connectionCode(seed: string): string {
  const payload = {
    u: "https://script.google.com/macros/s/AKfycbTEST_id-1/exec",
    k: seed.repeat(32),
    s: "1AbCdEfGhIjKlMnOpQrStUv",
  };
  return `keiri1_${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;
}

afterEach(() => {
  if (original === undefined) delete env.KEIRI_CONNECTION;
  else env.KEIRI_CONNECTION = original;
});

test("暗号化した秘密が復号でき、毎回違う文字列になる", async () => {
  env.KEIRI_CONNECTION = connectionCode("a");
  const a = await encryptSecret("JBSWY3DPEHPK3PXP");
  const b = await encryptSecret("JBSWY3DPEHPK3PXP");
  assert.notEqual(a, b);
  assert.match(a, /^v1\.[\w-]+\.[\w-]+$/);
  assert.equal(await decryptSecret(a), "JBSWY3DPEHPK3PXP");
  assert.ok(!a.includes("JBSWY3DPEHPK3PXP"));
});

test("接続コードを作り直すと復号できない（未設定として扱う）", async () => {
  env.KEIRI_CONNECTION = connectionCode("a");
  const box = await encryptSecret("SECRET");
  env.KEIRI_CONNECTION = connectionCode("b");
  assert.equal(await decryptSecret(box), null);
});

test("改ざんや形違いは null", async () => {
  env.KEIRI_CONNECTION = connectionCode("a");
  const box = await encryptSecret("SECRET");
  const [v, iv, ct] = box.split(".");
  const flipped = ct.startsWith("A") ? `B${ct.slice(1)}` : `A${ct.slice(1)}`;
  assert.equal(await decryptSecret(`${v}.${iv}.${flipped}`), null);
  for (const bad of ["", "x", "v1.a", "v2.a.b", `${v}.${iv}.`]) {
    assert.equal(await decryptSecret(bad), null, bad);
  }
});

test("回復コードの HMAC は、鍵・ユーザー・コードで変わる", async () => {
  env.KEIRI_CONNECTION = connectionCode("a");
  const h = await recoveryCodeHmac("u1", "ABCDEFGHJKMN");
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(h, await recoveryCodeHmac("u1", "ABCDEFGHJKMN"));
  assert.notEqual(h, await recoveryCodeHmac("u2", "ABCDEFGHJKMN"));
  assert.notEqual(h, await recoveryCodeHmac("u1", "ABCDEFGHJKMP"));
  assert.notEqual(h, await sha256Hex("u1:ABCDEFGHJKMN"));
  env.KEIRI_CONNECTION = connectionCode("b");
  assert.notEqual(h, await recoveryCodeHmac("u1", "ABCDEFGHJKMN"));
});
