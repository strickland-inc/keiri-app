import assert from "node:assert/strict";
import { createVerify, generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { createSheetsApi, getAccessToken } from "./rest.ts";

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = "sa@example.iam.gserviceaccount.com";
// .env と同じく、改行を \n でエスケープした 1 行の形で渡す
process.env.GOOGLE_PRIVATE_KEY = pem.replace(/\n/g, "\\n");
process.env.SHEETS_SPREADSHEET_ID = "sheet-id";

function mockFetch(handler: (url: URL, init: RequestInit) => unknown) {
  const calls: { url: URL; init: RequestInit }[] = [];
  globalThis.fetch = (async (input: URL | string, init: RequestInit = {}) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    const body = handler(url, init);
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
  return calls;
}

test("JWT は RS256 で正しく署名され、トークンは使い回される", async () => {
  const calls = mockFetch(() => ({ access_token: "tok", expires_in: 3600 }));
  assert.equal(await getAccessToken(["scope-a"]), "tok");
  assert.equal(await getAccessToken(["scope-a"]), "tok");
  assert.equal(calls.length, 1, "2 回目はキャッシュを使う");

  const form = new URLSearchParams(String(calls[0].init.body));
  assert.equal(
    form.get("grant_type"),
    "urn:ietf:params:oauth:grant-type:jwt-bearer",
  );
  const [header, claims, signature] = (form.get("assertion") ?? "").split(".");
  const decode = (s: string) =>
    JSON.parse(Buffer.from(s, "base64url").toString());
  assert.deepEqual(decode(header), { alg: "RS256", typ: "JWT" });
  assert.equal(decode(claims).iss, "sa@example.iam.gserviceaccount.com");
  assert.equal(decode(claims).scope, "scope-a");
  const verifier = createVerify("RSA-SHA256");
  verifier.update(`${header}.${claims}`);
  assert.ok(
    verifier.verify(publicKey, Buffer.from(signature, "base64url")),
    "署名が検証できる",
  );
});

test("Sheets: 範囲を URL エンコードし、認証ヘッダと { data } の形で返す", async () => {
  const calls = mockFetch((url) =>
    url.hostname === "oauth2.googleapis.com"
      ? { access_token: "tok2", expires_in: 3600 }
      : { values: [["a", "b"]] },
  );
  const sheets = createSheetsApi(["scope-b"]);
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: "s1",
    range: "documents!A:Z",
  });
  assert.deepEqual(res.data.values, [["a", "b"]]);
  const api = calls.find((c) => c.url.hostname === "sheets.googleapis.com");
  assert.equal(api?.url.pathname, "/v4/spreadsheets/s1/values/documents!A%3AZ");
  assert.equal(
    (api?.init.headers as Record<string, string>).Authorization,
    "Bearer tok2",
  );

  await sheets.spreadsheets.values.append({
    spreadsheetId: "s1",
    range: "documents!A:A",
    valueInputOption: "RAW",
    requestBody: { values: [["x"]] },
  });
  const append = calls.at(-1);
  assert.equal(append?.init.method, "POST");
  assert.equal(append?.url.searchParams.get("valueInputOption"), "RAW");
  assert.match(append?.url.pathname ?? "", /:append$/);
});

test("API エラーは状態コードつきで投げる", async () => {
  globalThis.fetch = (async (input: URL | string) =>
    String(input).includes("oauth2")
      ? new Response(JSON.stringify({ access_token: "t", expires_in: 3600 }))
      : new Response("denied", { status: 403 })) as typeof fetch;
  await assert.rejects(
    createSheetsApi(["scope-c"]).spreadsheets.get({ spreadsheetId: "s1" }),
    /403/,
  );
});

test("batchGet: 複数の範囲を 1 回で読み、ranges を繰り返して付ける", async () => {
  const calls = mockFetch((url) =>
    url.hostname === "oauth2.googleapis.com"
      ? { access_token: "tok3", expires_in: 3600 }
      : {
          valueRanges: [{ values: [["h"], ["a"]] }, { values: [["h"], ["b"]] }],
        },
  );
  const res = await createSheetsApi(["scope-d"]).spreadsheets.values.batchGet({
    spreadsheetId: "s1",
    ranges: ["documents!A:Z", "parties!A:Z"],
  });
  const api = calls.find((c) => c.url.hostname === "sheets.googleapis.com");
  assert.match(api?.url.pathname ?? "", /values:batchGet$/);
  assert.deepEqual(api?.url.searchParams.getAll("ranges"), [
    "documents!A:Z",
    "parties!A:Z",
  ]);
  assert.equal(res.data.valueRanges?.length, 2);
});
