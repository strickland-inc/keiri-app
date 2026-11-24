import assert from "node:assert/strict";
import { test } from "node:test";
import {
  base32Decode,
  base32Encode,
  buildOtpauthUri,
  formatTotpSecret,
  generateRecoveryCodes,
  generateTotpSecret,
  normalizeRecoveryCode,
  totpCode,
  totpStep,
  verifyTotp,
} from "./totp.ts";

// RFC 6238 の付録 B（SHA-1）。秘密は ASCII の "12345678901234567890"
const RFC_SECRET = base32Encode(
  new TextEncoder().encode("12345678901234567890"),
);
const RFC_VECTORS: Array<[number, string]> = [
  [59, "94287082"],
  [1111111109, "07081804"],
  [1111111111, "14050471"],
  [1234567890, "89005924"],
  [2000000000, "69279037"],
  [20000000000, "65353130"],
];

test("base32 が RFC 4648 の値と往復する", () => {
  const enc = (s: string) => base32Encode(new TextEncoder().encode(s));
  assert.equal(enc(""), "");
  assert.equal(enc("f"), "MY");
  assert.equal(enc("fo"), "MZXQ");
  assert.equal(enc("foo"), "MZXW6");
  assert.equal(enc("foob"), "MZXW6YQ");
  assert.equal(enc("fooba"), "MZXW6YTB");
  assert.equal(enc("foobar"), "MZXW6YTBOI");
  assert.equal(new TextDecoder().decode(base32Decode("MZXW6YTBOI")!), "foobar");
  assert.equal(
    new TextDecoder().decode(base32Decode("mzxw 6ytb-oi==")!),
    "foobar",
  );
  assert.equal(base32Decode("MZXW1"), null);
});

test("RFC 6238 の既知の値（8 桁）と、その下 6 桁が一致する", async () => {
  for (const [seconds, expected] of RFC_VECTORS) {
    assert.equal(
      await totpCode(RFC_SECRET, seconds * 1000, 8),
      expected,
      String(seconds),
    );
    assert.equal(
      await totpCode(RFC_SECRET, seconds * 1000),
      expected.slice(2),
      String(seconds),
    );
  }
});

test("前後 1 ステップは通り、2 ステップ離れたコードは通らない", async () => {
  const now = 1111111111 * 1000;
  const step = totpStep(now);
  const at = async (delta: number) =>
    (await totpCode(RFC_SECRET, (step + delta) * 30_000))!;
  assert.equal(await verifyTotp(RFC_SECRET, await at(0), now), step);
  assert.equal(await verifyTotp(RFC_SECRET, await at(-1), now), step - 1);
  assert.equal(await verifyTotp(RFC_SECRET, await at(1), now), step + 1);
  assert.equal(await verifyTotp(RFC_SECRET, await at(2), now), null);
  assert.equal(await verifyTotp(RFC_SECRET, await at(-2), now), null);
  assert.equal(await verifyTotp(RFC_SECRET, "12345", now), null);
  assert.equal(await verifyTotp(RFC_SECRET, "abcdef", now), null);
});

test("秘密は 20 バイトの乱数の base32 で、4 文字区切りにできる", () => {
  const a = generateTotpSecret();
  assert.match(a, /^[A-Z2-7]{32}$/);
  assert.equal(base32Decode(a)!.length, 20);
  assert.notEqual(a, generateTotpSecret());
  assert.equal(formatTotpSecret("ABCDEFGHIJ"), "ABCD EFGH IJ");
});

test("otpauth の URI の形", () => {
  assert.equal(
    buildOtpauthUri("taro@example.com", "ABCD"),
    "otpauth://totp/keiri-app:taro%40example.com?secret=ABCD&issuer=keiri-app",
  );
});

test("回復コードは 12 文字で、紛らわしい文字を含まず、重ならない", () => {
  const codes = generateRecoveryCodes();
  assert.equal(codes.length, 10);
  assert.equal(new Set(codes).size, 10);
  for (const code of codes)
    assert.match(code, /^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{12}$/);
  assert.equal(normalizeRecoveryCode(" abcd-efgh ijkl "), "ABCDEFGHIJKL");
});
