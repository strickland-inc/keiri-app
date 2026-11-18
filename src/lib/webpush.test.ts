import assert from "node:assert/strict";
import {
  createDecipheriv,
  createECDH,
  createVerify,
  generateKeyPairSync,
  hkdfSync,
} from "node:crypto";
import test from "node:test";
import {
  b64urlDecode,
  b64urlEncode,
  encryptPayload,
  sendWebPush,
  vapidAuthorization,
  WebPushError,
} from "./webpush.ts";

// RFC 8291 付録 A のテストベクトル
const RFC = {
  plaintext: "When I grow up, I want to be a watermelon",
  asPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  asPublic:
    "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  uaPublic:
    "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  authSecret: "BTBZMqHH6r4Tts7J_aSIgg",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  body: "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
};

test("RFC 8291 のテストベクトルと暗号文が一致する", async () => {
  const publicRaw = b64urlDecode(RFC.asPublic);
  const body = await encryptPayload(
    new TextEncoder().encode(RFC.plaintext),
    b64urlDecode(RFC.uaPublic),
    b64urlDecode(RFC.authSecret),
    {
      salt: b64urlDecode(RFC.salt),
      senderKeys: {
        publicRaw,
        privateJwk: {
          kty: "EC",
          crv: "P-256",
          d: RFC.asPrivate,
          x: b64urlEncode(publicRaw.slice(1, 33)),
          y: b64urlEncode(publicRaw.slice(33, 65)),
        },
      },
    },
  );
  assert.equal(b64urlEncode(body), RFC.body);
});

test("暗号化した内容を、受信側の鍵で RFC どおりに復号できる（Node 標準の暗号関数で独立に検証）", async () => {
  const receiver = createECDH("prime256v1");
  receiver.generateKeys();
  const authSecret = Buffer.from("0123456789abcdef");
  const message = "今週の支出レポート: 合計 ¥123,456";

  const body = Buffer.from(
    await encryptPayload(
      new TextEncoder().encode(message),
      receiver.getPublicKey(),
      authSecret,
    ),
  );
  const salt = body.subarray(0, 16);
  assert.equal(body.readUInt32BE(16), 4096);
  const idLength = body[20];
  const senderPublic = body.subarray(21, 21 + idLength);
  const encrypted = body.subarray(21 + idLength);

  const shared = receiver.computeSecret(senderPublic);
  const keyInfo = Buffer.concat([
    Buffer.from("WebPush: info\0"),
    receiver.getPublicKey(),
    senderPublic,
  ]);
  const ikm = Buffer.from(hkdfSync("sha256", shared, authSecret, keyInfo, 32));
  const cek = Buffer.from(
    hkdfSync("sha256", ikm, salt, "Content-Encoding: aes128gcm\0", 16),
  );
  const nonce = Buffer.from(
    hkdfSync("sha256", ikm, salt, "Content-Encoding: nonce\0", 12),
  );
  const decipher = createDecipheriv("aes-128-gcm", cek, nonce);
  decipher.setAuthTag(encrypted.subarray(-16));
  const plain = Buffer.concat([
    decipher.update(encrypted.subarray(0, -16)),
    decipher.final(),
  ]);

  assert.equal(plain[plain.length - 1], 2, "最終レコードの区切り");
  assert.equal(plain.subarray(0, -1).toString(), message);
});

test("VAPID の JWT は ES256 で署名され、公開鍵で検証できる", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", {
    namedCurve: "P-256",
  });
  const jwk = privateKey.export({ format: "jwk" });
  const pubJwk = publicKey.export({ format: "jwk" });
  const publicRaw = new Uint8Array([
    4,
    ...Buffer.from(String(pubJwk.x), "base64url"),
    ...Buffer.from(String(pubJwk.y), "base64url"),
  ]);
  const header = await vapidAuthorization("https://push.example.com/send/abc", {
    subject: "mailto:ops@example.com",
    publicKey: b64urlEncode(publicRaw),
    privateKey: String(jwk.d),
  });
  const match = header.match(/^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=(.+)$/);
  assert.ok(match, "形式が正しい");
  const [, h, c, sig, k] = match;
  assert.equal(k, b64urlEncode(publicRaw));
  const claims = JSON.parse(Buffer.from(c, "base64url").toString());
  assert.equal(claims.aud, "https://push.example.com");
  assert.equal(claims.sub, "mailto:ops@example.com");
  assert.ok(claims.exp > Date.now() / 1000);
  const verifier = createVerify("SHA256");
  verifier.update(`${h}.${c}`);
  assert.ok(
    verifier.verify(
      { key: publicKey, dsaEncoding: "ieee-p1363" },
      Buffer.from(sig, "base64url"),
    ),
  );
});

test("送信: 暗号化ヘッダを付けて POST し、失効（410）は statusCode つきで投げる", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", {
    namedCurve: "P-256",
  });
  const jwk = privateKey.export({ format: "jwk" });
  const pub = publicKey.export({ format: "jwk" });
  const vapid = {
    subject: "mailto:ops@example.com",
    publicKey: b64urlEncode(
      new Uint8Array([
        4,
        ...Buffer.from(String(pub.x), "base64url"),
        ...Buffer.from(String(pub.y), "base64url"),
      ]),
    ),
    privateKey: String(jwk.d),
  };
  const subscription = {
    endpoint: "https://push.example.com/send/xyz",
    keys: { p256dh: RFC.uaPublic, auth: RFC.authSecret },
  };

  let seen: RequestInit | undefined;
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    seen = init;
    return new Response(null, { status: 201 });
  }) as unknown as typeof fetch;
  await sendWebPush(subscription, '{"title":"t"}', vapid);
  const headers = seen?.headers as Record<string, string>;
  assert.equal(headers["Content-Encoding"], "aes128gcm");
  assert.match(headers.Authorization, /^vapid t=/);

  globalThis.fetch = (async () =>
    new Response(null, { status: 410 })) as unknown as typeof fetch;
  await assert.rejects(sendWebPush(subscription, "x", vapid), (e: unknown) => {
    return e instanceof WebPushError && e.statusCode === 410;
  });
});
