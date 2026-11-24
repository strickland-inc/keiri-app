/**
 * auth-server.ts を、偽の窓口（apps-script/Code.gs を Node で動かしたもの）につないだ
 * スプレッドシート版の Repository で通す。メモリ版と同じ内容に加え、行の書き手の分離を実物の行で確かめる。
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { loadGateway } from "../../apps-script/fake-apps-script.mjs";
import { setGatewayTransport } from "./gateway.ts";
import type { GatewayCall } from "./gateway.ts";
import { SHEET_NAMES, TABLES } from "../repositories/sheets/schema.ts";
import * as server from "./auth-server.ts";
import { defineAuthSuite } from "./auth-server.suite.ts";

const SAMPLE_PASSPHRASE = "correct-horse-battery";
const KEY = "k".repeat(40);
const SPREADSHEET_ID = "1AbCdEfGhIjKlMnOpQrStUvWx";
const WEB_APP_URL = "https://script.google.com/macros/s/AKfycbTEST_id-1/exec";
const env = process.env as Record<string, string | undefined>;
const saved = {
  KEIRI_CONNECTION: env.KEIRI_CONNECTION,
  KEIRI_DEMO_AUTH: env.KEIRI_DEMO_AUTH,
};

let gateway = loadGateway({ key: KEY, spreadsheetId: SPREADSHEET_ID });
let connection = "";
const calls: GatewayCall[] = [];

function install(): void {
  gateway = loadGateway({ key: KEY, spreadsheetId: SPREADSHEET_ID });
  connection = gateway.context.issueConnectionCode(WEB_APP_URL, false);
  env.KEIRI_CONNECTION = connection;
  // sheetsApi は、最初の通信でしかタブを作らない。新しい窓口には、ここで見出しつきのタブを作っておく
  const ensured = gateway.post({
    key: KEY,
    calls: [
      {
        op: "ensureTabs",
        tabs: TABLES.map((t) => ({ name: t.name, header: [...t.header] })),
      },
    ],
  });
  assert.equal(ensured.ok, true);
  setGatewayTransport(async (_connection, body) => {
    const parsed = JSON.parse(body) as { calls: GatewayCall[] };
    calls.push(...parsed.calls);
    return JSON.stringify(gateway.post(body));
  });
}

before(() => {
  delete env.KEIRI_DEMO_AUTH;
  install();
});

after(() => {
  setGatewayTransport(null);
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
});

function rows(tab: string): unknown[][] {
  return gateway.spreadsheet.sheet(tab).values.slice(1);
}

function rowOf(tab: string, id: string): unknown[] | undefined {
  return rows(tab).find((row) => row[0] === id);
}

defineAuthSuite({
  async reset() {
    install();
    calls.length = 0;
  },
  async seedLegacyUser(loginId, passwordHash) {
    const id = crypto.randomUUID();
    const ts = new Date().toISOString();
    const response = gateway.post({
      key: KEY,
      calls: [
        {
          op: "append",
          tab: SHEET_NAMES.users,
          rows: [[id, loginId, passwordHash, "admin", ts, ts]],
        },
      ],
    });
    assert.equal(response.ok, true);
    return id;
  },
  connectionCode: () => connection,
  counterRowCount: () => rows(SHEET_NAMES.authCounters).length,
});

// 以下は、スプレッドシート版だけで確かめること。suite の reset で窓口が作り直されるので、各テストは自分で状態を作る。

test("新しいタブは見出しつきで作られ、既存の users の列は変わらない", () => {
  install();
  assert.deepEqual(gateway.spreadsheet.sheet("users").values[0], [
    "id",
    "loginId",
    "passwordHash",
    "role",
    "createdAt",
    "updatedAt",
  ]);
  assert.deepEqual(gateway.spreadsheet.sheet("user_profiles").values[0], [
    "id",
    "displayName",
    "updatedAt",
  ]);
  assert.deepEqual(gateway.spreadsheet.sheet("user_security").values[0], [
    "id",
    "passwordHash",
    "passwordChangedAt",
    "totpSecret",
    "totpEnabledAt",
    "recoveryCodes",
    "updatedAt",
  ]);
  assert.deepEqual(gateway.spreadsheet.sheet("user_access").values[0], [
    "id",
    "status",
    "updatedAt",
  ]);
  assert.deepEqual(gateway.spreadsheet.sheet("session_versions").values[0], [
    "key",
    "seq",
  ]);
  assert.deepEqual(gateway.spreadsheet.sheet("auth_counters").values[0], [
    "key",
    "seq",
  ]);
  assert.equal(gateway.spreadsheet.sheet("invites").values[0].length, 10);
  assert.equal(gateway.spreadsheet.sheet("audit_log").values[0].length, 10);
});

test("表示名の書き込みは user_profiles だけ、管理者の書き込みは user_security と user_profiles に触れない", async () => {
  install();
  calls.length = 0;
  const repos = await (await import("@/repositories")).getRepositories();
  const admin = await repos.users.create({
    loginId: "boss",
    displayName: "管理者",
    passwordHash: await server.hashPassword(SAMPLE_PASSPHRASE),
    role: "admin",
  });
  const user = await repos.users.create({
    loginId: "member",
    displayName: "メンバー",
    passwordHash: await server.hashPassword(SAMPLE_PASSPHRASE),
    role: "user",
  });
  const adminSession = {
    sub: admin.id,
    role: "admin" as const,
    loginId: "boss",
    displayName: "管理者",
  };
  await server.setUserStatus(adminSession, user.id, "disabled");
  const usersBefore = rowOf("users", user.id);
  const accessBefore = rowOf("user_access", user.id);
  assert.ok(accessBefore && accessBefore[1] === "disabled");

  await repos.users.updateProfile(user.id, { displayName: "改名" });
  assert.deepEqual(rowOf("users", user.id), usersBefore);
  assert.deepEqual(rowOf("user_access", user.id), accessBefore);
  assert.equal(rowOf("user_profiles", user.id)?.[1], "改名");

  const securityBefore = rowOf("user_security", user.id);
  const profileBefore = rowOf("user_profiles", user.id);
  await server.setUserStatus(adminSession, user.id, "active");
  assert.deepEqual(rowOf("user_security", user.id), securityBefore);
  assert.deepEqual(rowOf("user_profiles", user.id), profileBefore);
  assert.equal(rowOf("user_access", user.id)?.[1], "active");
});

test("新しいタブへの書き込みは、updateById を使わず、upsertById だけを使う", async () => {
  install();
  calls.length = 0;
  const hash = await server.hashPassword(SAMPLE_PASSPHRASE);
  const id = crypto.randomUUID();
  const ts = new Date().toISOString();
  gateway.post({
    key: KEY,
    calls: [
      {
        op: "append",
        tab: "users",
        rows: [[id, "old.user", hash, "admin", ts, ts]],
      },
    ],
  });
  const newTabs = new Set([
    "user_profiles",
    "user_security",
    "user_access",
    "auth_counters",
    "session_versions",
    "invites",
    "audit_log",
  ]);
  const session = {
    sub: id,
    role: "admin" as const,
    loginId: "old.user",
    displayName: "old.user",
  };
  await server.attemptLogin("old.user", "wrong-password-xx", "1.1.1.1");
  await server.attemptLogin("old.user", SAMPLE_PASSPHRASE, "1.1.1.1");
  await server.changeDisplayName(session, "旧");
  await server.changePassword(
    session,
    SAMPLE_PASSPHRASE,
    "another-long-passphrase",
  );
  await server.revokeAllSessions(session);
  await server.setUserRole(session, id, "admin");
  const invite = await server.createInvite(session, { role: "user", note: "" });
  await server.acceptInvite(
    invite.token,
    {
      loginId: "second",
      displayName: "二人目",
      password: SAMPLE_PASSPHRASE,
    },
    "",
  );
  const bad = calls.filter(
    (call) => call.op === "updateById" && newTabs.has(call.tab),
  );
  assert.deepEqual(bad, []);
  // users に updateById を送るのは、管理者による役割の変更だけ
  const usersUpdates = calls.filter(
    (call) => call.op === "updateById" && call.tab === "users",
  );
  assert.ok(usersUpdates.length <= 1);
});

test("ログインの試行は、照合の前に 2 つの鍵を 1 回の通信で数える。存在しない ID は共通の 1 つの鍵だけを数える", async () => {
  install();
  const repos = await (await import("@/repositories")).getRepositories();
  const user = await repos.users.create({
    loginId: "counted",
    displayName: "数える",
    passwordHash: await server.hashPassword(SAMPLE_PASSPHRASE),
    role: "user",
  });
  calls.length = 0;
  await server.attemptLogin("ghost", "whatever-password-1", "1.1.1.1");
  const ghostWrites = calls.filter(
    (call) => call.op !== "read" && call.op !== "ensureTabs",
  );
  assert.equal(ghostWrites.length, 1);
  assert.ok(
    ghostWrites[0].op === "nextSeq" &&
      ghostWrites[0].key.startsWith("fail:unknown:"),
  );
  calls.length = 0;
  await server.attemptLogin("counted", "wrong-password-xx", "1.1.1.1");
  const seqKeys = calls.flatMap((call) =>
    call.op === "nextSeq" ? [call.key] : [],
  );
  assert.equal(seqKeys.length, 3);
  assert.ok(seqKeys.every((key) => key.includes(user.id)));
  // 数えた 2 つの鍵は、パスワードの照合より前に、同じ通信で送られる
  assert.ok(
    seqKeys[0].startsWith("fail:ip:") && seqKeys[1].startsWith("fail:all:"),
  );
  const keys = rows("auth_counters").map((row) => String(row[0]));
  assert.ok(keys.some((k) => k.startsWith(`fail:ip:${user.id}:1.1.1.1:`)));
  assert.ok(keys.some((k) => k.startsWith(`fail:all:${user.id}:`)));
  assert.ok(keys.some((k) => k.startsWith(`fail:log:${user.id}:`)));
});

test("役割の変更は users の行だけを書き、user_access を書き直さない。版数は session_versions にあり、必ず増える", async () => {
  install();
  const repos = await (await import("@/repositories")).getRepositories();
  const hash = await server.hashPassword(SAMPLE_PASSPHRASE);
  const admin = await repos.users.create({
    loginId: "boss",
    displayName: "管理者",
    passwordHash: hash,
    role: "admin",
  });
  const user = await repos.users.create({
    loginId: "member",
    displayName: "メンバー",
    passwordHash: hash,
    role: "user",
  });
  const session = {
    sub: admin.id,
    role: "admin" as const,
    loginId: "boss",
    displayName: "管理者",
  };
  calls.length = 0;
  await server.setUserRole(session, user.id, "admin");
  const written = calls.flatMap((call) =>
    call.op === "upsertById" || call.op === "updateById" ? [call.tab] : [],
  );
  assert.deepEqual(written, ["users"]);
  assert.equal(rowOf("user_access", user.id), undefined);
  assert.equal(rowOf("session_versions", `admin:${user.id}`)?.[1], "1");

  // 本人の側の版も、列ではなく鍵。何度でも増えるだけで、減らない
  const own = { ...session, sub: user.id, loginId: "member" };
  await server.revokeAllSessions(own);
  await server.revokeAllSessions(own);
  assert.equal(rowOf("session_versions", `self:${user.id}`)?.[1], "2");
  assert.equal((await repos.users.get(user.id))!.securityVersion, 2);

  // 削除すると、版数の行も消える
  await server.deleteUser(session, user.id);
  assert.equal(rowOf("session_versions", `admin:${user.id}`), undefined);
  assert.equal(rowOf("session_versions", `self:${user.id}`), undefined);
});

test("読んだあとで別の書き込みが入っても、古い表示名の書き込みは、パスワード・2段階認証・版数・状態を戻せない", async () => {
  install();
  const repos = await (await import("@/repositories")).getRepositories();
  const admin = await repos.users.create({
    loginId: "boss",
    displayName: "管理者",
    passwordHash: await server.hashPassword(SAMPLE_PASSPHRASE),
    role: "admin",
  });
  const user = await repos.users.create({
    loginId: "victim",
    displayName: "本人",
    passwordHash: await server.hashPassword(SAMPLE_PASSPHRASE),
    role: "user",
  });
  // Cookie を盗んだ人が、古い状態を読んでおく
  const stale = (await repos.users.get(user.id))!;
  const session = {
    sub: user.id,
    role: "user" as const,
    loginId: "victim",
    displayName: "本人",
  };
  // そのあとで、本人がパスワードを変え、全端末からログアウトし、管理者が無効にした
  await server.changePassword(
    session,
    SAMPLE_PASSPHRASE,
    "another-long-passphrase",
  );
  await server.revokeAllSessions(session);
  await server.setUserStatus(
    {
      sub: admin.id,
      role: "admin",
      loginId: "boss",
      displayName: "管理者",
    },
    user.id,
    "disabled",
  );
  const before = (await repos.users.get(user.id))!;
  assert.notEqual(before.passwordHash, stale.passwordHash);

  // 古い値を持った表示名の書き込みを、何度繰り返しても
  for (let i = 0; i < 3; i++) {
    await repos.users.updateProfile(user.id, {
      displayName: `${stale.displayName}${i}`,
    });
  }
  const after = (await repos.users.get(user.id))!;
  assert.equal(after.passwordHash, before.passwordHash);
  assert.equal(after.passwordChangedAt, before.passwordChangedAt);
  assert.equal(after.totpSecret, before.totpSecret);
  assert.equal(after.securityVersion, before.securityVersion);
  assert.equal(after.accessVersion, before.accessVersion);
  assert.equal(after.status, "disabled");
  assert.equal(after.displayName, `${stale.displayName}2`);
});

test("2段階認証の秘密は、スプレッドシートに平文で残らない", async () => {
  install();
  const repos = await (await import("@/repositories")).getRepositories();
  const user = await repos.users.create({
    loginId: "cipher",
    displayName: "暗号",
    passwordHash: await server.hashPassword(SAMPLE_PASSPHRASE),
    role: "user",
  });
  const { secret } = await server.beginTotpEnrollment(user.id);
  const dump = JSON.stringify(
    gateway.spreadsheet.sheet("user_security").values,
  );
  assert.ok(!dump.includes(secret));
  assert.match(String(rowOf("user_security", user.id)?.[3]), /^v1\./);
});
