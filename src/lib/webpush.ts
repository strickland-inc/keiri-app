/**
 * Web Push の送信（RFC 8291 の aes128gcm 暗号化 + RFC 8292 の VAPID）。Web Crypto と fetch だけで動く。
 * `web-push` パッケージは Node 専用で Cloudflare Workers で動かせないため置き換えた。
 */

export interface PushSubscriptionKeys {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface VapidDetails {
  subject: string;
  /** base64url の公開鍵（65 バイトの非圧縮形式）。 */
  publicKey: string;
  /** base64url の秘密鍵（32 バイト）。 */
  privateKey: string;
}

/** 配信サービスが 404/410 を返した（購読が失効した）などのエラー。 */
export class WebPushError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "WebPushError";
    this.statusCode = statusCode;
  }
}

const RECORD_SIZE = 4096;
const TTL_SECONDS = 24 * 60 * 60;
const subtle = crypto.subtle;
const encoder = new TextEncoder();

export function b64urlDecode(value: string): Uint8Array {
  const padded = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

export function b64urlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

async function hkdf(
  ikm: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
  bytes: number,
): Promise<Uint8Array> {
  const key = await subtle.importKey(
    "raw",
    ikm as BufferSource,
    "HKDF",
    false,
    ["deriveBits"],
  );
  const bits = await subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: salt as BufferSource,
      info: info as BufferSource,
    },
    key,
    bytes * 8,
  );
  return new Uint8Array(bits);
}

export interface EncryptOptions {
  /** テスト用: 送信側の一時鍵を固定する。 */
  senderKeys?: { privateJwk: JsonWebKey; publicRaw: Uint8Array };
  /** テスト用: salt（16 バイト）を固定する。 */
  salt?: Uint8Array;
}

/** ペイロードを aes128gcm のレコード（ヘッダ付き）に暗号化する。 */
export async function encryptPayload(
  payload: Uint8Array,
  subscriberPublic: Uint8Array,
  authSecret: Uint8Array,
  options: EncryptOptions = {},
): Promise<Uint8Array> {
  let privateKey: CryptoKey;
  let senderPublic: Uint8Array;
  if (options.senderKeys) {
    privateKey = await subtle.importKey(
      "jwk",
      options.senderKeys.privateJwk,
      { name: "ECDH", namedCurve: "P-256" },
      false,
      ["deriveBits"],
    );
    senderPublic = options.senderKeys.publicRaw;
  } else {
    const pair = await subtle.generateKey(
      { name: "ECDH", namedCurve: "P-256" },
      true,
      ["deriveBits"],
    );
    privateKey = pair.privateKey;
    senderPublic = new Uint8Array(
      await subtle.exportKey("raw", pair.publicKey),
    );
  }

  const receiver = await subtle.importKey(
    "raw",
    subscriberPublic as BufferSource,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const sharedSecret = new Uint8Array(
    await subtle.deriveBits(
      { name: "ECDH", public: receiver },
      privateKey,
      256,
    ),
  );

  const salt = options.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const keyInfo = concat(
    encoder.encode("WebPush: info\0"),
    subscriberPublic,
    senderPublic,
  );
  const ikm = await hkdf(sharedSecret, authSecret, keyInfo, 32);
  const contentKey = await hkdf(
    ikm,
    salt,
    encoder.encode("Content-Encoding: aes128gcm\0"),
    16,
  );
  const nonce = await hkdf(
    ikm,
    salt,
    encoder.encode("Content-Encoding: nonce\0"),
    12,
  );

  // 1 レコードだけ（末尾の 0x02 が最終レコードの区切り）
  const plaintext = concat(payload, new Uint8Array([2]));
  const aes = await subtle.importKey(
    "raw",
    contentKey as BufferSource,
    "AES-GCM",
    false,
    ["encrypt"],
  );
  const ciphertext = new Uint8Array(
    await subtle.encrypt(
      { name: "AES-GCM", iv: nonce as BufferSource },
      aes,
      plaintext as BufferSource,
    ),
  );

  const header = concat(
    salt,
    new Uint8Array([
      (RECORD_SIZE >>> 24) & 255,
      (RECORD_SIZE >>> 16) & 255,
      (RECORD_SIZE >>> 8) & 255,
      RECORD_SIZE & 255,
    ]),
    new Uint8Array([senderPublic.length]),
    senderPublic,
  );
  return concat(header, ciphertext);
}

/** VAPID の Authorization ヘッダ値を作る（ES256 の JWT）。 */
export async function vapidAuthorization(
  endpoint: string,
  vapid: VapidDetails,
): Promise<string> {
  const publicRaw = b64urlDecode(vapid.publicKey);
  const key = await subtle.importKey(
    "jwk",
    {
      kty: "EC",
      crv: "P-256",
      d: vapid.privateKey,
      x: b64urlEncode(publicRaw.slice(1, 33)),
      y: b64urlEncode(publicRaw.slice(33, 65)),
    },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const header = b64urlEncode(
    encoder.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })),
  );
  const claims = b64urlEncode(
    encoder.encode(
      JSON.stringify({
        aud: new URL(endpoint).origin,
        exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
        sub: vapid.subject,
      }),
    ),
  );
  // WebCrypto の ECDSA 署名は r||s の 64 バイトで、JWT（ES256）の形式と同じ
  const signature = new Uint8Array(
    await subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      encoder.encode(`${header}.${claims}`),
    ),
  );
  return `vapid t=${header}.${claims}.${b64urlEncode(signature)}, k=${vapid.publicKey}`;
}

/** 1 件の購読へ通知を送る。失効（404/410）などは WebPushError を投げる。 */
export async function sendWebPush(
  subscription: PushSubscriptionKeys,
  payload: string,
  vapid: VapidDetails,
): Promise<void> {
  const body = await encryptPayload(
    encoder.encode(payload),
    b64urlDecode(subscription.keys.p256dh),
    b64urlDecode(subscription.keys.auth),
  );
  const res = await fetch(subscription.endpoint, {
    method: "POST",
    headers: {
      Authorization: await vapidAuthorization(subscription.endpoint, vapid),
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: String(TTL_SECONDS),
    },
    body: body as BufferSource,
  });
  if (!res.ok) {
    throw new WebPushError(
      `Web Push の送信に失敗しました (${res.status})`,
      res.status,
    );
  }
}
