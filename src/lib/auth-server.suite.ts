/**
 * auth-server.ts の主要な流れのテスト。メモリ版（auth-server.test.ts）とスプレッドシート版
 * （auth-server.sheets.test.ts、偽の窓口を使う）で、同じ内容を通す。
 * このファイルは *.test.ts ではないので、単独では実行されない。
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import { getRepositories } from "@/repositories";
import type { UserRole } from "@/domain/user";
import { sessionVersionOf } from "@/domain/user";
import { decryptSecret } from "./secret-box.ts";
import { totpCode } from "./totp.ts";
import { listAudit, recordAudit } from "./audit.ts";
import type { Session } from "./session.ts";
import * as server from "./auth-server.ts";

export interface Harness {
  /** 空の状態に戻す。 */
  reset(): Promise<void>;
  /** 新しいタブができる前の、users だけに 6 列の行がある既存の利用者を作る。id を返す。 */
  seedLegacyUser(loginId: string, passwordHash: string): Promise<string>;
  /** /setup と /recover に入れる接続コード。 */
  connectionCode(): string;
  /** auth_counters の行数。 */
  counterRowCount(): number;
}

const GOOD_PASSPHRASE = "correct-horse-battery";
const RECOVERY_PASSPHRASE = "recover-me-please-1";
const NEW_PASSPHRASE = "another-long-passphrase";
/** 時刻を固定する（TOTP と窓の境目をまたがないため）。 */
const BASE_TIME = 1_800_000_000_000;

let sequence = 0;

function nextOf(result: Awaited<ReturnType<typeof server.attemptLogin>>) {
  return result.ok ? result.next : null;
}

export function defineAuthSuite(h: Harness): void {
  let clock: ReturnType<typeof mock.method> | null = null;

  function freeze(ms = BASE_TIME): void {
    if (clock) clock.mock.restore();
    clock = mock.method(Date, "now", () => ms);
  }
  function setNow(ms: number): void {
    if (!clock) freeze(ms);
    else clock.mock.mockImplementation(() => ms);
  }

  beforeEach(async () => {
    await h.reset();
    freeze();
  });
  afterEach(() => {
    clock?.mock.restore();
    clock = null;
    mock.restoreAll();
  });

  async function repos() {
    return getRepositories();
  }

  function uniqueId(prefix: string): string {
    sequence += 1;
    return `${prefix}${sequence}`;
  }

  async function createUser(
    loginId: string,
    role: UserRole = "user",
    password: string = GOOD_PASSPHRASE,
  ) {
    return (await repos()).users.create({
      loginId,
      displayName: `表示 ${loginId}`,
      passwordHash: await server.hashPassword(password),
      role,
    });
  }

  async function sessionOf(userId: string): Promise<Session> {
    const user = await (await repos()).users.get(userId);
    assert.ok(user, "ユーザーがいる");
    return {
      sub: user.id,
      role: user.role,
      loginId: user.loginId,
      displayName: user.displayName,
    };
  }

  async function enableTotp(userId: string): Promise<{
    secret: string;
    recoveryCodes: string[];
  }> {
    const { secret } = await server.beginTotpEnrollment(userId);
    const code = (await totpCode(secret, Date.now()))!;
    const confirmed = await server.confirmTotpEnrollment(userId, code);
    assert.ok(confirmed.ok, JSON.stringify(confirmed));
    // 設定のときに使ったコードは、次のステップまで再利用できない
    setNow(Date.now() + 30_000);
    return { secret, recoveryCodes: confirmed.value.recoveryCodes };
  }

  async function currentCode(secret: string): Promise<string> {
    return (await totpCode(secret, Date.now()))!;
  }

  // ── ログイン ──────────────────────────────────────────────────────────────

  test("ログインできる。ID は大文字小文字を区別せず、成功は監査ログに残る", async () => {
    const user = await createUser("Taro.Yamada");
    assert.equal(user.loginId, "taro.yamada");
    const result = await server.attemptLogin(
      "TARO.YAMADA",
      GOOD_PASSPHRASE,
      "1.1.1.1",
    );
    assert.deepEqual(result, { ok: true, userId: user.id, next: "session" });
    const audit = await listAudit({ action: "login.success" });
    assert.equal(audit.length, 1);
    assert.equal(audit[0].actorId, user.id);
    assert.equal(audit[0].ip, "1.1.1.1");
  });

  test("パスワードが違えば失敗し、存在しない ID でも同じ結果で、行は窓ごとに 1 行しか増えない", async () => {
    const user = await createUser("hanako");
    assert.deepEqual(
      await server.attemptLogin("hanako", "wrong-password-1", "1.1.1.1"),
      { ok: false },
    );
    const auditBefore = (await listAudit()).length;
    for (let i = 0; i < 3; i++) {
      assert.deepEqual(
        await server.attemptLogin(`nobody${i}`, GOOD_PASSPHRASE, `1.1.1.${i}`),
        { ok: false },
      );
    }
    // 存在しない ID は、窓ごとの共通の鍵 fail:unknown:<窓> だけを増やす（ID ごとの行は作らない）
    const rowsAfterFirst = h.counterRowCount();
    for (let i = 3; i < 30; i++) {
      await server.attemptLogin(`nobody${i}`, GOOD_PASSPHRASE, `2.2.2.${i}`);
    }
    assert.equal(h.counterRowCount(), rowsAfterFirst);
    assert.equal((await listAudit()).length, auditBefore);
    // 本物のユーザーの失敗は、窓ごとの最初の 1 回だけ監査ログに残る
    await server.attemptLogin("hanako", "wrong-password-2", "1.1.1.1");
    const failures = await listAudit({ action: "login.failure" });
    assert.equal(failures.length, 1);
    assert.equal(failures[0].actorId, user.id);
    assert.ok(!JSON.stringify(failures).includes("wrong-password"));
  });

  test("同じ IP からの試行が 15 分に 10 回を超えると、正しいパスワードでも照合せずに断る。別の IP は通る", async () => {
    const user = await createUser("locked.user");
    for (let i = 0; i < 10; i++) {
      assert.equal(
        (
          await server.attemptLogin(
            "locked.user",
            `wrong-pass-${i}-xx`,
            "9.9.9.9",
          )
        ).ok,
        false,
      );
    }
    assert.equal(
      (await server.attemptLogin("locked.user", GOOD_PASSPHRASE, "9.9.9.9")).ok,
      false,
    );
    const other = await server.attemptLogin(
      "locked.user",
      GOOD_PASSPHRASE,
      "8.8.8.8",
    );
    assert.deepEqual(other, { ok: true, userId: user.id, next: "session" });
    // 上限を超えた最初の 1 回だけ記録される
    assert.equal((await listAudit({ action: "login.locked" })).length, 1);
    assert.equal((await listAudit({ action: "login.failure" })).length, 1);
    // 窓が変われば解ける
    setNow(Date.now() + 16 * 60 * 1000);
    assert.equal(
      (await server.attemptLogin("locked.user", GOOD_PASSPHRASE, "9.9.9.9")).ok,
      true,
    );
  });

  test("成功した試行も数に入る。同じ ID へ 30 件を同時に送っても、照合に進めて成功するのは上限（10 回）まで", async () => {
    const user = await createUser("burst.user");
    const results = await Promise.all(
      Array.from({ length: 30 }, (_, i) =>
        server.attemptLogin(
          "burst.user",
          i % 3 === 0 ? "wrong-password-xx" : GOOD_PASSPHRASE,
          "3.3.3.3",
        ),
      ),
    );
    const successes = results.filter((r) => r.ok).length;
    assert.ok(successes >= 1, "上限以内の試行は通る");
    assert.ok(successes <= 10, `成功が上限を超えた: ${successes}`);
    // 別の IP からも、正しいパスワードで入れる（IP ごとの数。全体は 30 回で 50 以内）
    assert.deepEqual(
      await server.attemptLogin("burst.user", GOOD_PASSPHRASE, "4.3.3.3"),
      { ok: true, userId: user.id, next: "session" },
    );
  });

  test("パスワードの照合まで進む試行は、上限を超えない", async () => {
    await createUser("cpu.bound");
    // 照合まで進んだ数は、失敗のたびに増える fail:log の値で確かめる
    const r = await repos();
    const user = (await r.users.findByLoginId("cpu.bound"))!;
    await Promise.all(
      Array.from({ length: 30 }, () =>
        server.attemptLogin("cpu.bound", "wrong-password-xx", "6.6.6.6"),
      ),
    );
    // 間違ったパスワードで照合まで進めた試行は失敗を残す。fail:log は 1 窓に 1 回だけ（照合に進んだ試行の中で最初の 1 件）
    const window = Math.floor(Date.now() / (15 * 60 * 1000));
    const { values } = await r.authCounters.inspect(
      [`fail:ip:${user.id}:6.6.6.6:${window}`, `fail:log:${user.id}:${window}`],
      Date.now(),
    );
    assert.equal(values[0], 30);
    // fail:log を増やすのは、照合に進んだ失敗だけ。上限を超えた 20 件は、ここを増やさない
    assert.ok(
      values[1] >= 1 && values[1] <= 10,
      `照合まで進んだ失敗: ${values[1]}`,
    );
  });

  test("ID だけの全体のロック（1 時間に 50 回を超えたら）は、IP を変えても効く", async () => {
    const user = await createUser("all.locked");
    const window = Math.floor(Date.now() / (60 * 60 * 1000));
    await (
      await repos()
    ).authCounters.next(`fail:all:${user.id}:${window}`, 50);
    assert.equal(
      (await server.attemptLogin("all.locked", GOOD_PASSPHRASE, "7.7.7.7")).ok,
      false,
    );
    assert.equal(
      (await server.attemptLogin("all.locked", GOOD_PASSPHRASE, "6.6.6.6")).ok,
      false,
    );
    // 1 時間後には解ける
    setNow(Date.now() + 61 * 60 * 1000);
    assert.equal(
      (await server.attemptLogin("all.locked", GOOD_PASSPHRASE, "7.7.7.7")).ok,
      true,
    );
  });

  test("ログイン成功のついでに、1 日以上前の fail: の行を消す", async () => {
    await createUser("pruner");
    const r = await repos();
    const oldWindow = Math.floor(
      (Date.now() - 3 * 24 * 3600 * 1000) / (3600 * 1000),
    );
    const staleKey = `fail:all:someone:${oldWindow}`;
    const recentKey = `fail:all:someone:${Math.floor(Date.now() / (3600 * 1000))}`;
    await r.authCounters.next(staleKey);
    await r.authCounters.next(recentKey);
    assert.equal(
      (await server.attemptLogin("pruner", GOOD_PASSPHRASE, "1.1.1.1")).ok,
      true,
    );
    const { values } = await r.authCounters.inspect(
      [staleKey, recentKey],
      Date.now(),
    );
    assert.deepEqual(values, [0, 1]);
  });

  test("無効にされたユーザーは、正しいパスワードでもログインできない", async () => {
    const admin = await createUser("boss", "admin");
    const user = await createUser("worker");
    assert.ok(
      (
        await server.setUserStatus(
          await sessionOf(admin.id),
          user.id,
          "disabled",
        )
      ).ok,
    );
    assert.equal(
      (await server.attemptLogin("worker", GOOD_PASSPHRASE, "1.1.1.1")).ok,
      false,
    );
  });

  // ── セッションの版 ─────────────────────────────────────────────────────────

  test("無効化で sv が変わり、開いていたセッションは stale になる。再開しても古い sv は戻らない", async () => {
    const admin = await createUser("boss2", "admin");
    const user = await createUser("worker2");
    const r = await repos();
    const before = sessionVersionOf((await r.users.get(user.id))!);
    assert.equal(before, "0.0");
    assert.equal(
      (await server.resolveSession({ sub: user.id, sv: before })).stale,
      false,
    );

    await server.setUserStatus(await sessionOf(admin.id), user.id, "disabled");
    const stale = await server.resolveSession({ sub: user.id, sv: before });
    assert.deepEqual(stale, { session: null, stale: true });

    await server.setUserStatus(await sessionOf(admin.id), user.id, "active");
    assert.equal(
      (await server.resolveSession({ sub: user.id, sv: before })).stale,
      true,
    );
    const now = sessionVersionOf((await r.users.get(user.id))!);
    assert.equal(
      (await server.resolveSession({ sub: user.id, sv: now })).stale,
      false,
    );
  });

  test("削除したユーザーのセッションは stale。パスワード変更とすべての端末からのログアウトでも sv が変わる", async () => {
    const admin = await createUser("boss3", "admin");
    const user = await createUser("worker3");
    const r = await repos();
    const sv0 = sessionVersionOf((await r.users.get(user.id))!);
    assert.ok(
      (
        await server.changePassword(
          await sessionOf(user.id),
          GOOD_PASSPHRASE,
          NEW_PASSPHRASE,
        )
      ).ok,
    );
    const sv1 = sessionVersionOf((await r.users.get(user.id))!);
    assert.notEqual(sv1, sv0);
    await server.revokeAllSessions(await sessionOf(user.id));
    const sv2 = sessionVersionOf((await r.users.get(user.id))!);
    assert.notEqual(sv2, sv1);
    assert.equal(
      (await server.resolveSession({ sub: user.id, sv: sv1 })).stale,
      true,
    );

    assert.ok((await server.deleteUser(await sessionOf(admin.id), user.id)).ok);
    assert.deepEqual(await server.resolveSession({ sub: user.id, sv: sv2 }), {
      session: null,
      stale: true,
    });
    assert.equal(await r.users.get(user.id), null);
  });

  test("resolveSession は、今の権限と表示名を返す", async () => {
    const admin = await createUser("boss4", "admin");
    const user = await createUser("worker4");
    await server.setUserRole(await sessionOf(admin.id), user.id, "admin");
    const sv = sessionVersionOf((await (await repos()).users.get(user.id))!);
    const resolved = await server.resolveSession({ sub: user.id, sv });
    assert.deepEqual(resolved.session, {
      sub: user.id,
      role: "admin",
      loginId: "worker4",
      displayName: "表示 worker4",
    });
  });

  // ── 2段階認証 ──────────────────────────────────────────────────────────────

  test("2段階認証を有効にでき、ログインは totp に進み、コードの再利用は断られる", async () => {
    const user = await createUser("totp.user");
    const { secret, uri, qrSvg } = await server.beginTotpEnrollment(user.id);
    assert.match(qrSvg ?? "", /^<svg /);
    assert.match(
      uri,
      /^otpauth:\/\/totp\/keiri-app:totp\.user\?secret=[A-Z2-7]+&issuer=keiri-app$/,
    );
    // 有効化の前は、保存した秘密が暗号化されている
    const pending = await (await repos()).users.get(user.id);
    assert.ok(pending!.totpSecret && !pending!.totpEnabledAt);
    assert.notEqual(pending!.totpSecret, secret);
    assert.equal(await decryptSecret(pending!.totpSecret), secret);

    const wrong = await server.confirmTotpEnrollment(user.id, "000000");
    assert.equal(wrong.ok, false);
    const code = await currentCode(secret);
    const confirmed = await server.confirmTotpEnrollment(user.id, code);
    assert.ok(confirmed.ok);
    assert.equal(confirmed.value.recoveryCodes.length, 10);
    // 設定に使ったコードの再利用は断られる（同じ時間ステップ）
    assert.equal(
      (await server.verifySecondFactor(user.id, code, "1.1.1.1")).ok,
      false,
    );
    // 秘密は暗号化され、回復コードは平文で保存されない
    const stored = (await (await repos()).users.get(user.id))!;
    assert.ok(stored.totpEnabledAt);
    for (const rc of confirmed.value.recoveryCodes) {
      assert.ok(!stored.recoveryCodes.includes(rc));
      assert.ok(!JSON.stringify(stored).includes(rc));
    }

    assert.deepEqual(
      await server.attemptLogin("totp.user", GOOD_PASSPHRASE, "1.1.1.1"),
      {
        ok: true,
        userId: user.id,
        next: "totp",
      },
    );
    assert.equal(
      (await server.attemptLogin("totp.user", GOOD_PASSPHRASE, "1.1.1.1")).ok,
      true,
    );

    setNow(Date.now() + 30_000);
    const next = await currentCode(secret);
    assert.deepEqual(
      await server.verifySecondFactor(user.id, next, "1.1.1.1"),
      {
        ok: true,
        usedRecoveryCode: false,
      },
    );
    // 同じコードは 2 回目が通らない
    assert.equal(
      (await server.verifySecondFactor(user.id, next, "1.1.1.1")).ok,
      false,
    );
    // 有効化してから再度 begin はできない
    await assert.rejects(() => server.beginTotpEnrollment(user.id), /すでに/);
    assert.equal((await listAudit({ action: "totp.enabled" })).length, 1);
  });

  test("回復コードは 1 回だけ使え、使った後は一覧から外れる。作り直すと古いものは全部無効", async () => {
    const user = await createUser("recovery.user");
    const { recoveryCodes } = await enableTotp(user.id);
    const [first, second] = recoveryCodes;
    const spaced = `${first.slice(0, 4)}-${first.slice(4, 8)} ${first.slice(8).toLowerCase()}`;
    assert.deepEqual(
      await server.verifySecondFactor(user.id, spaced, "1.1.1.1"),
      {
        ok: true,
        usedRecoveryCode: true,
      },
    );
    assert.equal(
      (await server.verifySecondFactor(user.id, first, "1.1.1.1")).ok,
      false,
    );
    assert.equal(
      (await (await repos()).users.get(user.id))!.recoveryCodes.length,
      9,
    );
    assert.equal((await listAudit({ action: "recovery.used" })).length, 1);

    const session = await sessionOf(user.id);
    assert.equal(
      (await server.regenerateRecoveryCodes(session, "wrong-password-xx")).ok,
      false,
    );
    const fresh = await server.regenerateRecoveryCodes(
      session,
      GOOD_PASSPHRASE,
    );
    assert.ok(fresh.ok);
    assert.equal(
      (await server.verifySecondFactor(user.id, second, "1.1.1.1")).ok,
      false,
    );
    assert.equal(
      (
        await server.verifySecondFactor(
          user.id,
          fresh.value.recoveryCodes[0],
          "1.1.1.1",
        )
      ).ok,
      true,
    );
  });

  test("2段階認証のコードは、IP に関係なくユーザーごとに 15 分に 5 回まで。超えると正しいコードも照合せずに断る", async () => {
    const user = await createUser("totp.lock");
    const { secret } = await enableTotp(user.id);
    for (let i = 0; i < 5; i++) {
      assert.equal(
        (await server.verifySecondFactor(user.id, "000000", `5.5.5.${i}`)).ok,
        false,
      );
    }
    // IP を変えても同じ
    for (const ip of ["5.5.5.5", "4.4.4.4"]) {
      assert.equal(
        (
          await server.verifySecondFactor(
            user.id,
            await currentCode(secret),
            ip,
          )
        ).ok,
        false,
      );
    }
    assert.equal((await listAudit({ action: "login.locked" })).length, 1);
    // 窓が変われば解ける
    setNow(Date.now() + 16 * 60 * 1000);
    assert.equal(
      (
        await server.verifySecondFactor(
          user.id,
          await currentCode(secret),
          "4.4.4.4",
        )
      ).ok,
      true,
    );
  });

  test("接続コードを作り直して復号できないときは、2段階認証は未設定として扱う", async () => {
    const user = await createUser("lost.key");
    await enableTotp(user.id);
    // 暗号文を壊して、復号できない状態を作る
    await (
      await repos()
    ).users.updateSecurity(user.id, { totpSecret: "v1.AAAA.BBBB" });
    assert.deepEqual(
      await server.attemptLogin("lost.key", GOOD_PASSPHRASE, "1.1.1.1"),
      {
        ok: true,
        userId: user.id,
        next: "session",
      },
    );
    const summary = (await server.listUsers()).find((u) => u.id === user.id)!;
    assert.equal(summary.totpEnabled, false);
  });

  test("解除にはパスワードが要る。解除すると sv が変わる", async () => {
    const user = await createUser("totp.off");
    await enableTotp(user.id);
    const session = await sessionOf(user.id);
    const before = sessionVersionOf(
      (await (await repos()).users.get(user.id))!,
    );
    assert.equal(
      (await server.disableTotp(session, "wrong-password-xx")).ok,
      false,
    );
    assert.ok((await server.disableTotp(session, GOOD_PASSPHRASE)).ok);
    const after = (await (await repos()).users.get(user.id))!;
    assert.equal(after.totpEnabledAt, "");
    assert.deepEqual(after.recoveryCodes, []);
    assert.notEqual(sessionVersionOf(after), before);
    assert.equal(
      (await server.attemptLogin("totp.off", GOOD_PASSPHRASE, "1.1.1.1")).ok,
      true,
    );
  });

  test("管理者が 2段階認証をリセットすると、本人の sv が変わり、2段階認証が外れる", async () => {
    const admin = await createUser("boss5", "admin");
    const user = await createUser("totp.reset");
    await enableTotp(user.id);
    const before = sessionVersionOf(
      (await (await repos()).users.get(user.id))!,
    );
    assert.ok(
      (await server.resetUserTotp(await sessionOf(admin.id), user.id)).ok,
    );
    const after = (await (await repos()).users.get(user.id))!;
    assert.equal(after.totpEnabledAt, "");
    assert.equal(after.totpSecret, "");
    assert.notEqual(sessionVersionOf(after), before);
    assert.equal((await listAudit({ action: "totp.reset" })).length, 1);
  });

  test("requireTotp は、自分が未設定のときは有効にできない。有効の間は未設定の人は stale で、本人は解除できない", async () => {
    const admin = await createUser("boss6", "admin");
    const worker = await createUser("worker6");
    const adminSession = await sessionOf(admin.id);
    const denied = await server.setRequireTotp(adminSession, true);
    assert.equal(denied.ok, false);
    assert.equal(await server.isTotpRequired(), false);

    await enableTotp(admin.id);
    assert.ok((await server.setRequireTotp(adminSession, true)).ok);
    assert.equal(await server.isTotpRequired(), true);

    // 未設定の人: ログインは enroll、既存のセッションは stale
    const sv = sessionVersionOf((await (await repos()).users.get(worker.id))!);
    assert.equal(
      (await server.resolveSession({ sub: worker.id, sv })).stale,
      true,
    );
    assert.deepEqual(
      await server.attemptLogin("worker6", GOOD_PASSPHRASE, "1.1.1.1"),
      {
        ok: true,
        userId: worker.id,
        next: "enroll",
      },
    );
    // 設定済みの管理者は stale にならない
    const adminSv = sessionVersionOf(
      (await (await repos()).users.get(admin.id))!,
    );
    assert.equal(
      (await server.resolveSession({ sub: admin.id, sv: adminSv })).stale,
      false,
    );
    // 必須の間は、本人は解除できない
    const off = await server.disableTotp(adminSession, GOOD_PASSPHRASE);
    assert.equal(off.ok, false);
    assert.ok((await server.setRequireTotp(adminSession, false)).ok);
    assert.equal(await server.isTotpRequired(), false);
    assert.equal(
      (await listAudit({ action: "security.require_totp_changed" })).length,
      2,
    );
  });

  test("2段階認証が必須のとき、招待の受諾では login.success を残さない（設定が終わった時に残る）", async () => {
    const admin = await createUser("boss6b", "admin");
    const adminSession = await sessionOf(admin.id);
    await enableTotp(admin.id);
    assert.ok((await server.setRequireTotp(adminSession, true)).ok);
    const { token } = await server.createInvite(adminSession, {
      role: "user",
      note: "",
    });
    const joined = await server.acceptInvite(
      token,
      {
        loginId: "needs.enroll",
        displayName: "新人",
        password: GOOD_PASSPHRASE,
      },
      "1.1.1.1",
    );
    assert.ok(joined.ok);
    const before = await listAudit({ action: "login.success" });
    assert.equal(
      before.filter((e) => e.actorId === joined.value.userId).length,
      0,
    );
    const { secret } = await server.beginTotpEnrollment(joined.value.userId);
    const done = await server.confirmTotpEnrollment(
      joined.value.userId,
      await currentCode(secret),
      { login: true, ip: "4.4.4.4" },
    );
    assert.ok(done.ok);
    const after = await listAudit({ action: "login.success" });
    assert.equal(
      after.filter((e) => e.actorId === joined.value.userId).length,
      1,
    );
  });

  test("ログインの途中で 2段階認証を設定し終えると、login.success も残る", async () => {
    const user = await createUser("enroll.login");
    const { secret } = await server.beginTotpEnrollment(user.id);
    const result = await server.confirmTotpEnrollment(
      user.id,
      await currentCode(secret),
      {
        login: true,
        ip: "3.3.3.3",
      },
    );
    assert.ok(result.ok);
    const success = await listAudit({ action: "login.success" });
    assert.equal(success.length, 1);
    assert.equal(success[0].ip, "3.3.3.3");
  });

  // ── 最初の管理者 ───────────────────────────────────────────────────────────

  test("最初の管理者は、接続コードが合い、ユーザーが 0 人のときだけ作れる", async () => {
    const base = {
      loginId: "Owner",
      displayName: "代表",
      password: GOOD_PASSPHRASE,
    };
    assert.equal(
      (
        await server.createFirstAdmin({
          ...base,
          connectionCode: "違う接続コード",
        })
      ).ok,
      false,
    );
    assert.equal(
      (
        await server.createFirstAdmin({
          ...base,
          connectionCode: h.connectionCode(),
          password: "short",
        })
      ).ok,
      false,
    );
    const created = await server.createFirstAdmin({
      ...base,
      connectionCode: h.connectionCode(),
    });
    assert.ok(created.ok);
    const user = (await (await repos()).users.get(created.value.userId))!;
    assert.equal(user.role, "admin");
    assert.equal(user.loginId, "owner");
    assert.equal(user.displayName, "代表");
    const again = await server.createFirstAdmin({
      ...base,
      loginId: "other",
      connectionCode: h.connectionCode(),
    });
    assert.equal(again.ok, false);
    assert.equal((await (await repos()).users.list()).length, 1);
    // その場でログイン済みになるので、login.success も 1 件だけ残る（最終ログインの表示に使う）
    const logins = await listAudit({ action: "login.success" });
    assert.equal(logins.length, 1);
    assert.equal(logins[0].actorId, created.value.userId);
  });

  // ── 招待 ──────────────────────────────────────────────────────────────────

  test("招待: 作る、確かめる、受ける。同じリンクの 2 回目と、同時の受諾は 1 つだけ通る", async () => {
    const admin = await createUser("boss7", "admin");
    const adminSession = await sessionOf(admin.id);
    const worker = await sessionOf((await createUser("worker7")).id);
    await assert.rejects(
      () => server.createInvite(worker, { role: "user", note: "" }),
      /権限/,
    );

    const { token, expiresAt, inviteId } = await server.createInvite(
      adminSession,
      {
        role: "user",
        note: "経理の山田さん",
      },
    );
    assert.ok(Date.parse(expiresAt) - Date.now() === 7 * 24 * 3600 * 1000);
    assert.deepEqual(await server.inspectLink(token, "invite"), {
      valid: true,
      role: "user",
    });
    assert.deepEqual(await server.inspectLink(token, "reset"), {
      valid: false,
    });
    assert.deepEqual(await server.inspectLink(`${token}x`, "invite"), {
      valid: false,
    });
    // トークンそのものは保存されない
    const stored = await (await repos()).invites.get(inviteId);
    assert.ok(
      stored &&
        stored.tokenHash !== token &&
        !JSON.stringify(stored).includes(token),
    );

    const input = (loginId: string) => ({
      loginId,
      displayName: "山田",
      password: GOOD_PASSPHRASE,
    });
    const [a, b] = await Promise.all([
      server.acceptInvite(token, input("yamada.a"), "1.1.1.1"),
      server.acceptInvite(token, input("yamada.b"), "1.1.1.1"),
    ]);
    assert.equal([a, b].filter((r) => r.ok).length, 1);
    const winner = a.ok ? a : b;
    assert.ok(winner.ok);
    const created = (await (await repos()).users.get(winner.value.userId))!;
    assert.equal(created.role, "user");
    // その場でログイン済みになるので、login.success も 1 件だけ残る
    const logins = await listAudit({ action: "login.success" });
    assert.equal(logins.length, 1);
    assert.equal(logins[0].actorId, winner.value.userId);
    assert.equal(
      (await server.acceptInvite(token, input("yamada.c"), "1.1.1.1")).ok,
      false,
    );
    assert.deepEqual(await server.inspectLink(token, "invite"), {
      valid: false,
    });
    assert.equal(
      (await server.attemptLogin(created.loginId, GOOD_PASSPHRASE, "1.1.1.1"))
        .ok,
      true,
    );

    const summary = (await server.listInvites()).find(
      (i) => i.id === inviteId,
    )!;
    assert.equal(summary.status, "used");
    assert.ok(!("tokenHash" in summary));
    assert.equal((await listAudit({ action: "user.joined" })).length, 1);
  });

  test("招待: 期限が切れると使えない。入力の誤りでは、リンクは使われない。同じ ID は断る。取り消せる", async () => {
    const admin = await createUser("boss8", "admin");
    const adminSession = await sessionOf(admin.id);
    const first = await server.createInvite(adminSession, {
      role: "admin",
      note: "",
    });
    const input = {
      loginId: "newcomer",
      displayName: "新人",
      password: GOOD_PASSPHRASE,
    };

    assert.equal(
      (
        await server.acceptInvite(
          first.token,
          { ...input, password: "short" },
          "",
        )
      ).ok,
      false,
    );
    assert.equal(
      (
        await server.acceptInvite(
          first.token,
          { ...input, loginId: "BOSS8" },
          "",
        )
      ).ok,
      false,
    );
    assert.equal(
      (await server.acceptInvite(first.token, { ...input, loginId: "x" }, ""))
        .ok,
      false,
    );
    assert.deepEqual(await server.inspectLink(first.token, "invite"), {
      valid: true,
      role: "admin",
    });

    setNow(Date.now() + 7 * 24 * 3600 * 1000 + 1000);
    assert.equal((await server.acceptInvite(first.token, input, "")).ok, false);
    assert.equal((await server.listInvites())[0].status, "expired");

    setNow(BASE_TIME);
    const second = await server.createInvite(adminSession, {
      role: "user",
      note: "取り消す",
    });
    assert.ok((await server.revokeInvite(adminSession, second.inviteId)).ok);
    assert.equal(
      (await server.acceptInvite(second.token, input, "")).ok,
      false,
    );
    assert.equal(
      (await server.revokeInvite(adminSession, second.inviteId)).ok,
      false,
    );
    assert.equal((await listAudit({ action: "invite.revoked" })).length, 1);
  });

  // ── 再設定 ────────────────────────────────────────────────────────────────

  test("再設定リンク: 新しいパスワードが決まり、本人の sv が変わる。2 回目は使えず、2段階認証はそのまま", async () => {
    const admin = await createUser("boss9", "admin");
    const user = await createUser("forgetful");
    await enableTotp(user.id);
    const r = await repos();
    const before = sessionVersionOf((await r.users.get(user.id))!);
    const adminSession = await sessionOf(admin.id);
    const { token, expiresAt } = await server.createResetLink(
      adminSession,
      user.id,
    );
    assert.ok(Date.parse(expiresAt) - Date.now() === 24 * 3600 * 1000);
    assert.deepEqual(await server.inspectLink(token, "reset"), {
      valid: true,
      loginId: "forgetful",
    });
    assert.deepEqual(await server.inspectLink(token, "invite"), {
      valid: false,
    });

    // 規則に合わないパスワードでは、リンクは使われない
    assert.equal(
      (await server.resetPasswordWithLink(token, "short", "1.1.1.1")).ok,
      false,
    );
    const done = await server.resetPasswordWithLink(
      token,
      NEW_PASSPHRASE,
      "1.1.1.1",
    );
    assert.ok(done.ok);
    assert.equal(
      (
        await server.resetPasswordWithLink(
          token,
          "yet-another-passphrase",
          "1.1.1.1",
        )
      ).ok,
      false,
    );

    const after = (await r.users.get(user.id))!;
    assert.notEqual(sessionVersionOf(after), before);
    assert.ok(after.totpEnabledAt);
    assert.equal(
      (await server.attemptLogin("forgetful", GOOD_PASSPHRASE, "1.1.1.1")).ok,
      false,
    );
    assert.equal(
      nextOf(await server.attemptLogin("forgetful", NEW_PASSPHRASE, "2.2.2.2")),
      "totp",
    );
    assert.equal((await listAudit({ action: "reset.issued" })).length, 1);
    assert.equal((await listAudit({ action: "password.reset" })).length, 1);

    // 期限切れ
    const expired = await server.createResetLink(adminSession, user.id);
    setNow(Date.now() + 25 * 3600 * 1000);
    assert.equal(
      (await server.resetPasswordWithLink(expired.token, NEW_PASSPHRASE, ""))
        .ok,
      false,
    );
  });

  // ── /recover ──────────────────────────────────────────────────────────────

  test("管理者の復旧: 接続コードが違う、管理者でない、存在しない ID はどれも同じ文言で断る", async () => {
    await createUser("root", "admin");
    await createUser("plain");
    const results = await Promise.all([
      server.recoverAdmin(
        { connectionCode: "違う", loginId: "root", password: NEW_PASSPHRASE },
        "",
      ),
      server.recoverAdmin(
        {
          connectionCode: h.connectionCode(),
          loginId: "plain",
          password: NEW_PASSPHRASE,
        },
        "",
      ),
      server.recoverAdmin(
        {
          connectionCode: h.connectionCode(),
          loginId: "ghost",
          password: NEW_PASSPHRASE,
        },
        "",
      ),
    ]);
    const errors = results.map((r) => (r.ok ? null : r.error));
    assert.ok(errors.every((e) => e && e === errors[0]));
    assert.equal(
      (await server.attemptLogin("root", GOOD_PASSPHRASE, "1.1.1.1")).ok,
      true,
    );
    assert.equal((await listAudit({ action: "admin.recovered" })).length, 0);
  });

  test("管理者の復旧: パスワードを入れ替え、2段階認証を解除し、ロックを解き、有効に戻し、sv を上げる", async () => {
    const admin = await createUser("root2", "admin");
    const other = await createUser("root3", "admin");
    await enableTotp(admin.id);
    await server.setUserStatus(await sessionOf(other.id), admin.id, "disabled");
    for (let i = 0; i < 5; i++)
      await server.attemptLogin("root2", `wrong-pass-${i}-xx`, "9.9.9.9");
    const r = await repos();
    const before = sessionVersionOf((await r.users.get(admin.id))!);

    const weak = await server.recoverAdmin(
      {
        connectionCode: h.connectionCode(),
        loginId: "ROOT2",
        password: "short",
      },
      "9.9.9.9",
    );
    assert.equal(weak.ok, false);
    const done = await server.recoverAdmin(
      {
        connectionCode: h.connectionCode(),
        loginId: "ROOT2",
        password: NEW_PASSPHRASE,
      },
      "9.9.9.9",
    );
    assert.ok(done.ok);
    const after = (await r.users.get(admin.id))!;
    assert.equal(after.status, "active");
    assert.equal(after.totpEnabledAt, "");
    assert.notEqual(sessionVersionOf(after), before);
    // ロックも解けている（同じ IP で、新しいパスワードで通る）
    assert.deepEqual(
      await server.attemptLogin("root2", NEW_PASSPHRASE, "9.9.9.9"),
      {
        ok: true,
        userId: admin.id,
        next: "session",
      },
    );
    const audit = await listAudit({ action: "admin.recovered" });
    assert.equal(audit.length, 1);
    assert.ok(!JSON.stringify(audit).includes(NEW_PASSPHRASE));
    assert.ok(!JSON.stringify(audit).includes(h.connectionCode()));
  });

  // ── 管理者の保護 ──────────────────────────────────────────────────────────

  test("最後の 1 人の有効な管理者は、降格・無効化・削除できない。自分自身の削除と無効化もできない", async () => {
    const a = await createUser("admin.a", "admin");
    const b = await createUser("admin.b", "admin");
    const user = await createUser("plain2");
    const sessionA = await sessionOf(a.id);
    const sessionB = await sessionOf(b.id);

    assert.equal((await server.deleteUser(sessionA, a.id)).ok, false);
    assert.equal(
      (await server.setUserStatus(sessionA, a.id, "disabled")).ok,
      false,
    );
    assert.ok((await server.setUserRole(sessionA, b.id, "user")).ok);
    // B はメンバーになった。A は最後の 1 人
    assert.equal((await server.setUserRole(sessionB, a.id, "user")).ok, false);
    assert.equal(
      (await server.setUserStatus(sessionB, a.id, "disabled")).ok,
      false,
    );
    assert.equal((await server.deleteUser(sessionB, a.id)).ok, false);
    assert.equal((await server.setUserRole(sessionA, a.id, "user")).ok, false);
    assert.equal((await (await repos()).users.get(a.id))!.role, "admin");
    // メンバーは削除できる
    assert.ok((await server.deleteUser(sessionA, user.id)).ok);
    // 管理者でないセッションは、管理の操作を呼べない
    const plain = await sessionOf(b.id);
    await assert.rejects(() => server.setUserRole(plain, a.id, "user"), /権限/);
  });

  test("listUsers は、パスワードのハッシュも秘密も含まない", async () => {
    const user = await createUser("lister", "admin");
    await enableTotp(user.id);
    const list = await server.listUsers();
    assert.deepEqual(list, [
      {
        id: user.id,
        loginId: "lister",
        displayName: "表示 lister",
        role: "admin",
        status: "active",
        totpEnabled: true,
        createdAt: user.createdAt,
      },
    ]);
    const text = JSON.stringify(list);
    assert.ok(!text.includes("pbkdf2") && !text.includes("totpSecret"));
  });

  // ── 既存の利用者の移行と、書き手の分離 ────────────────────────────────────

  test("既存の利用者（users に 6 列だけ）は、そのままログイン・パスワード変更・無効化ができる", async () => {
    const hash = await server.hashPassword(GOOD_PASSPHRASE);
    const id = await h.seedLegacyUser("Legacy.Admin", hash);
    const second = await createUser("modern", "admin");
    const r = await repos();

    const legacy = (await r.users.get(id))!;
    assert.equal(legacy.loginId, "legacy.admin");
    assert.equal(legacy.displayName, "legacy.admin");
    assert.equal(legacy.status, "active");
    assert.equal(sessionVersionOf(legacy), "0.0");

    assert.deepEqual(
      await server.attemptLogin("legacy.admin", GOOD_PASSPHRASE, "1.1.1.1"),
      {
        ok: true,
        userId: id,
        next: "session",
      },
    );
    const session = await sessionOf(id);
    assert.ok((await server.changeDisplayName(session, "旧管理者")).ok);
    assert.ok(
      (await server.changePassword(session, GOOD_PASSPHRASE, NEW_PASSPHRASE))
        .ok,
    );
    assert.equal(
      (await server.attemptLogin("legacy.admin", GOOD_PASSPHRASE, "1.1.1.1"))
        .ok,
      false,
    );
    assert.equal(
      (await server.attemptLogin("legacy.admin", NEW_PASSPHRASE, "1.1.1.1")).ok,
      true,
    );
    assert.equal((await r.users.get(id))!.displayName, "旧管理者");

    const secondSession = await sessionOf(second.id);
    assert.ok((await server.setUserRole(secondSession, id, "user")).ok);
    assert.ok((await server.setUserStatus(secondSession, id, "disabled")).ok);
    assert.equal(
      (await server.attemptLogin("legacy.admin", NEW_PASSPHRASE, "1.1.1.1")).ok,
      false,
    );
    assert.ok((await server.setUserStatus(secondSession, id, "active")).ok);
    assert.ok((await server.resetUserTotp(secondSession, id)).ok);
    assert.ok((await server.deleteUser(secondSession, id)).ok);
    assert.equal(await r.users.get(id), null);
  });

  test("既存の利用者も、2段階認証と招待と再設定を使える", async () => {
    const id = await h.seedLegacyUser(
      "legacy.totp",
      await server.hashPassword(GOOD_PASSPHRASE),
    );
    const { secret } = await enableTotp(id);
    assert.equal(
      nextOf(
        await server.attemptLogin("legacy.totp", GOOD_PASSPHRASE, "1.1.1.1"),
      ),
      "totp",
    );
    assert.equal(
      (
        await server.verifySecondFactor(
          id,
          await currentCode(secret),
          "1.1.1.1",
        )
      ).ok,
      true,
    );
  });

  test("書き手の分離: 本人の書き込みのあとも、管理者が入れた status と role は変わらない（逆も同じ）", async () => {
    const admin = await createUser("boss10", "admin");
    const user = await createUser("separate");
    const adminSession = await sessionOf(admin.id);
    const r = await repos();

    assert.ok((await server.setUserRole(adminSession, user.id, "admin")).ok);
    assert.ok(
      (await server.setUserStatus(adminSession, user.id, "disabled")).ok,
    );
    const afterAdmin = (await r.users.get(user.id))!;
    assert.deepEqual(
      [afterAdmin.role, afterAdmin.status],
      ["admin", "disabled"],
    );

    // 無効化された本人が自分の行を書き続けても、無効化は打ち消されない
    const ownSession = await sessionOf(user.id);
    assert.ok((await server.changeDisplayName(ownSession, "名前を変えた")).ok);
    await server.revokeAllSessions(ownSession);
    await r.users.updateProfile(user.id, { displayName: "さらに変えた" });
    const afterSelf = (await r.users.get(user.id))!;
    assert.deepEqual([afterSelf.role, afterSelf.status], ["admin", "disabled"]);
    assert.equal(afterSelf.accessVersion, afterAdmin.accessVersion);
    assert.equal(afterSelf.displayName, "さらに変えた");

    // 管理者の書き込みは、本人の表示名・パスワード・本人の側の版を変えない
    assert.ok((await server.setUserStatus(adminSession, user.id, "active")).ok);
    const afterBoth = (await r.users.get(user.id))!;
    assert.equal(afterBoth.displayName, "さらに変えた");
    assert.equal(afterBoth.securityVersion, afterSelf.securityVersion);
    assert.equal(afterBoth.passwordHash, afterSelf.passwordHash);
    assert.equal(afterBoth.status, "active");
  });

  // ── 監査ログ ──────────────────────────────────────────────────────────────

  test("監査ログの書き込みに失敗しても、投げない。本体の操作も失敗しない", async () => {
    const admin = await createUser("boss11", "admin");
    const r = await repos();
    const original = r.audit.append;
    const errors = mock.method(console, "error", () => {});
    r.audit.append = async () => {
      throw new Error("書けません");
    };
    try {
      await assert.doesNotReject(() => recordAudit("system", "test.action"));
      const result = await server.createInvite(await sessionOf(admin.id), {
        role: "user",
        note: "",
      });
      assert.ok(result.token);
      assert.ok(errors.mock.callCount() >= 2);
    } finally {
      r.audit.append = original;
    }
  });

  test("監査ログに、パスワード・トークン・接続コード・回復コード・秘密が入らない。新しい順に返る", async () => {
    const admin = await createUser("boss12", "admin");
    const adminSession = await sessionOf(admin.id);
    const { token } = await server.createInvite(adminSession, {
      role: "user",
      note: "メモ",
    });
    const joined = await server.acceptInvite(
      token,
      { loginId: "audited", displayName: "監査", password: GOOD_PASSPHRASE },
      "1.1.1.1",
    );
    assert.ok(joined.ok);
    const { secret, recoveryCodes } = await enableTotp(joined.value.userId);
    await server.attemptLogin("audited", "wrong-secret-pass1", "1.1.1.1");
    const reset = await server.createResetLink(
      adminSession,
      joined.value.userId,
    );
    await server.resetPasswordWithLink(reset.token, NEW_PASSPHRASE, "1.1.1.1");
    await server.recoverAdmin(
      {
        connectionCode: h.connectionCode(),
        loginId: "boss12",
        password: RECOVERY_PASSPHRASE,
      },
      "",
    );
    const text = JSON.stringify(await listAudit());
    for (const secretValue of [
      GOOD_PASSPHRASE,
      NEW_PASSPHRASE,
      "wrong-secret-pass1",
      RECOVERY_PASSPHRASE,
      token,
      reset.token,
      secret,
      h.connectionCode(),
      ...recoveryCodes,
    ]) {
      assert.ok(
        !text.includes(secretValue),
        `監査ログに秘密が入っている: ${secretValue.slice(0, 6)}`,
      );
    }
    const list = await listAudit();
    assert.ok(list.length >= 6);
    for (let i = 1; i < list.length; i++)
      assert.ok(list[i - 1].at >= list[i].at);
    assert.equal((await listAudit({ limit: 2 })).length, 2);
    assert.ok(
      (await listAudit({ actorId: admin.id })).every(
        (e) => e.actorId === admin.id,
      ),
    );
  });

  test("パスワードの変更は、現在のパスワードと規則を確かめる", async () => {
    const user = await createUser("pw.change");
    const session = await sessionOf(user.id);
    assert.equal(
      (
        await server.changePassword(
          session,
          "wrong-password-xx",
          NEW_PASSPHRASE,
        )
      ).ok,
      false,
    );
    assert.equal(
      (await server.changePassword(session, GOOD_PASSPHRASE, "short")).ok,
      false,
    );
    assert.equal(
      (await server.changePassword(session, GOOD_PASSPHRASE, "pw.change")).ok,
      false,
    );
    assert.equal(
      (await server.changePassword(session, GOOD_PASSPHRASE, "Password1234"))
        .ok,
      false,
    );
    assert.ok(
      (await server.changePassword(session, GOOD_PASSPHRASE, NEW_PASSPHRASE))
        .ok,
    );
    assert.equal((await listAudit({ action: "password.changed" })).length, 1);
    assert.equal((await server.changeDisplayName(session, "   ")).ok, false);
  });

  // ── 追加の修正 ────────────────────────────────────────────────────────────

  test("beginTotpEnrollmentWithPassword: 誤ったパスワードは拒否し、正しければ毎回新しい秘密を作り、設定済みなら拒否する", async () => {
    const user = await createUser(uniqueId("enrol"));
    const session = await sessionOf(user.id);
    const wrong = await server.beginTotpEnrollmentWithPassword(
      session,
      "wrong-password-xx",
    );
    assert.equal(wrong.ok, false);
    assert.equal((await (await repos()).users.get(user.id))!.totpSecret, "");

    const first = await server.beginTotpEnrollmentWithPassword(
      session,
      GOOD_PASSPHRASE,
    );
    const second = await server.beginTotpEnrollmentWithPassword(
      session,
      GOOD_PASSPHRASE,
    );
    assert.ok(first.ok && second.ok);
    if (first.ok && second.ok) {
      assert.notEqual(first.value.secret, second.value.secret);
      assert.match(first.value.uri, /^otpauth:\/\/totp\//);
    }

    // 確認まで済ませたあとは、パスワードが合っていても作り直せない
    if (second.ok) {
      const code = await currentCode(second.value.secret);
      const confirmed = await server.confirmTotpEnrollment(user.id, code);
      assert.ok(confirmed.ok);
    }
    const again = await server.beginTotpEnrollmentWithPassword(
      session,
      GOOD_PASSPHRASE,
    );
    assert.equal(again.ok, false);
  });

  test("管理者を無効にする、メンバーにする、削除すると、その管理者が作った未使用のリンクが取り消され、監査ログに残る", async () => {
    const boss = await createUser(uniqueId("boss"), "admin");
    const author = await createUser(uniqueId("author"), "admin");
    const target = await createUser(uniqueId("member"));
    const bossSession = await sessionOf(boss.id);
    const authorSession = await sessionOf(author.id);
    const invite = await server.createInvite(authorSession, {
      role: "user",
      note: "未使用",
    });
    const reset = await server.createResetLink(authorSession, target.id);
    const others = await server.createInvite(bossSession, {
      role: "user",
      note: "別の管理者のもの",
    });

    // メンバーにする
    assert.ok((await server.setUserRole(bossSession, author.id, "user")).ok);
    assert.equal(
      (
        await server.acceptInvite(
          invite.token,
          { loginId: "z1", displayName: "x", password: NEW_PASSPHRASE },
          "",
        )
      ).ok,
      false,
    );
    assert.deepEqual(await server.inspectLink(reset.token, "reset"), {
      valid: false,
    });
    const revoked = await listAudit({ action: "invite.revoked" });
    assert.equal(revoked.length, 2);
    assert.ok(revoked.every((row) => row.summary.includes(author.loginId)));
    // 別の管理者が作ったリンクは残る
    assert.deepEqual(await server.inspectLink(others.token, "invite"), {
      valid: true,
      role: "user",
    });

    // 無効にする、削除する場合も同じ
    const second = await createUser(uniqueId("second"), "admin");
    await server.createInvite(await sessionOf(second.id), {
      role: "user",
      note: "無効にされる",
    });
    assert.ok(
      (await server.setUserStatus(bossSession, second.id, "disabled")).ok,
    );
    assert.equal((await listAudit({ action: "invite.revoked" })).length, 3);
    const third = await createUser(uniqueId("third"), "admin");
    await server.createInvite(await sessionOf(third.id), {
      role: "user",
      note: "削除される",
    });
    assert.ok((await server.deleteUser(bossSession, third.id)).ok);
    assert.equal((await listAudit({ action: "invite.revoked" })).length, 4);
  });

  test("一意な ID を使う補助の確認", () => {
    assert.notEqual(uniqueId("a"), uniqueId("a"));
  });
}
