/**
 * 2段階認証の秘密の暗号化（AES-GCM）と、回復コードの HMAC。
 * 鍵は接続コードの鍵から HKDF で作る。スプレッドシートを読める人が秘密や回復コードを取り出せないようにするため。
 * 接続コードを作り直すと復号できなくなる。そのときは null を返し、呼び出し側は「未設定」として扱う。
 */
import { b64urlToBytes, bytesToB64url, getKeyMaterial } from "./auth.ts";

const HKDF_SALT = new TextEncoder().encode("keiri-app");
const TOTP_INFO = "keiri-totp-v1";
const RECOVERY_INFO = "keiri-recovery-v1";
const BOX_VERSION = "v1";

async function hkdfBits(info: string): Promise<ArrayBuffer> {
  const base = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(getKeyMaterial()),
    "HKDF",
    false,
    ["deriveBits"],
  );
  return crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: HKDF_SALT,
      info: new TextEncoder().encode(info),
    },
    base,
    256,
  );
}

async function aesKey(usage: "encrypt" | "decrypt"): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    await hkdfBits(TOTP_INFO),
    { name: "AES-GCM" },
    false,
    [usage],
  );
}

/** 平文を暗号化する。形式は `v1.<iv>.<暗号文>`（base64url）。 */
export async function encryptSecret(plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      await aesKey("encrypt"),
      new TextEncoder().encode(plain),
    ),
  );
  return `${BOX_VERSION}.${bytesToB64url(iv)}.${bytesToB64url(cipher)}`;
}

/** 復号する。形が違う、鍵が違う、改ざんされているときは null。 */
export async function decryptSecret(box: string): Promise<string | null> {
  const [version, ivText, cipherText] = box.split(".");
  if (version !== BOX_VERSION || !ivText || !cipherText) return null;
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: b64urlToBytes(ivText) as BufferSource },
      await aesKey("decrypt"),
      b64urlToBytes(cipherText) as BufferSource,
    );
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}

/**
 * 回復コードの HMAC-SHA256（16 進）。塩なしの SHA-256 だと、スプレッドシートを読める人が総当たりで割り出せるため、
 * 接続コードの鍵から作った鍵を使う。ユーザー ID も混ぜて、別の人の同じコードと区別する。
 */
export async function recoveryCodeHmac(
  userId: string,
  code: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    await hkdfBits(RECOVERY_INFO),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(`${userId}:${code}`),
    ),
  );
  return Array.from(mac, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** SHA-256（16 進）。招待トークンの保存に使う。 */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
