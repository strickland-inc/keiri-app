/**
 * 2段階認証（TOTP、RFC 6238）。SHA-1、6 桁、30 秒。Web Crypto だけで動く。
 */

export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = 6;
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** RFC 4648 の base32（パディングなし）。 */
export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/** base32 を戻す。空白・ハイフン・"=" は無視し、小文字も読む。不正な文字があれば null。 */
export function base32Decode(text: string): Uint8Array | null {
  const clean = text.replace(/[\s=-]/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index < 0) return null;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Uint8Array.from(out);
}

/** 20 バイトの乱数を base32 にした秘密。 */
export function generateTotpSecret(): string {
  return base32Encode(crypto.getRandomValues(new Uint8Array(20)));
}

/** 手入力しやすいよう 4 文字ごとに区切る。 */
export function formatTotpSecret(secret: string): string {
  return secret.replace(/(.{4})(?=.)/g, "$1 ");
}

/** HOTP（RFC 4226）。digits は 6 か 8。 */
export async function hotp(
  key: Uint8Array,
  counter: number,
  digits: number = TOTP_DIGITS,
): Promise<string> {
  const message = new Uint8Array(8);
  new DataView(message.buffer).setBigUint64(0, BigInt(counter));
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key as BufferSource,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const mac = new Uint8Array(
    await crypto.subtle.sign("HMAC", cryptoKey, message),
  );
  const offset = mac[mac.length - 1] & 0x0f;
  const binary =
    ((mac[offset] & 0x7f) << 24) |
    (mac[offset + 1] << 16) |
    (mac[offset + 2] << 8) |
    mac[offset + 3];
  return String(binary % 10 ** digits).padStart(digits, "0");
}

/** 時刻（ミリ秒）の時間ステップ。 */
export function totpStep(nowMs: number): number {
  return Math.floor(nowMs / 1000 / TOTP_PERIOD_SECONDS);
}

/** その時刻のコード。 */
export async function totpCode(
  secret: string,
  nowMs: number,
  digits: number = TOTP_DIGITS,
): Promise<string | null> {
  const key = base32Decode(secret);
  if (!key || key.length === 0) return null;
  return hotp(key, totpStep(nowMs), digits);
}

/**
 * コードが前後 1 ステップ以内で合っていれば、合った時間ステップを返す。合わなければ null。
 * 同じコードの再利用は、呼び出し側が nextSeq（`totp:<userId>`）で防ぐ。
 */
export async function verifyTotp(
  secret: string,
  code: string,
  nowMs: number,
  window = 1,
): Promise<number | null> {
  const clean = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(clean)) return null;
  const key = base32Decode(secret);
  if (!key || key.length === 0) return null;
  const current = totpStep(nowMs);
  let matched: number | null = null;
  // どのステップで合っても同じ回数だけ計算する（早く返さない）
  for (let delta = -window; delta <= window; delta++) {
    const step = current + delta;
    if (step < 0) continue;
    const expected = await hotp(key, step);
    if (expected === clean && matched === null) matched = step;
  }
  return matched;
}

/** 認証アプリに読み込ませる URI。 */
export function buildOtpauthUri(loginId: string, secret: string): string {
  return `otpauth://totp/keiri-app:${encodeURIComponent(loginId)}?secret=${secret}&issuer=keiri-app`;
}

// 紛らわしい文字（0 O 1 I L）を除いた 31 文字。
const RECOVERY_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export const RECOVERY_CODE_COUNT = 10;
export const RECOVERY_CODE_LENGTH = 12;

/** 回復コード（12 文字）を count 個作る。偏りが出ないよう、余りの出る乱数は捨てて引き直す。 */
export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
  const size = RECOVERY_ALPHABET.length;
  const limit = 256 - (256 % size);
  return Array.from({ length: count }, () => {
    let code = "";
    while (code.length < RECOVERY_CODE_LENGTH) {
      for (const byte of crypto.getRandomValues(new Uint8Array(32))) {
        if (byte < limit && code.length < RECOVERY_CODE_LENGTH) {
          code += RECOVERY_ALPHABET[byte % size];
        }
      }
    }
    return code;
  });
}

/** 入力された回復コードをそろえる（大文字、区切りの除去）。 */
export function normalizeRecoveryCode(code: string): string {
  return code.replace(/[\s-]/g, "").toUpperCase();
}
