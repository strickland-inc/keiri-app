/**
 * 認証のうち、パスワードのハッシュ（PBKDF2）、2段階認証、招待、管理の操作など、Repository に依存する部分。
 * proxy が読み込む lib/auth.ts とは分ける（proxy が Repository を巻き込まないように）。
 *
 * 守っていること:
 *  - 1 つの行を書くのは 1 種類の書き手だけ（user-merge.ts の冒頭に一覧がある）。
 *    表示名（user_profiles）は Cookie だけで書ける。パスワードと 2段階認証（user_security）は、
 *    パスワードの再入力・招待や再設定のリンク・接続コード・保留 Cookie（ログインの途中）のどれかを通した操作だけが書く。
 *    例外は、管理者による 2段階認証のリセット（resetUserTotp）。これが本人のパスワード変更と同時に起きると、
 *    片方の書き込みが消えうる。管理者は信頼する相手で、起きても再操作で戻せるので、そのままにしている。
 *  - 版数（session_versions）は列に持たず nextSeq の鍵にする。必ず増えるので、古い書き込みで戻せない。
 *  - 一度きりの操作と回数は、書き込む前に nextSeq（auth_counters）で決める。
 *    ログインの失敗は「数えてから判断する」。照合の前に加算して、返った値が上限を超えていたら照合せずに断る。
 *    読んでから照合する形だと、同じ ID に同時に送られた試行が全部「ロックされていない」を読んでしまい、上限が効かない。
 *  - 存在しないログイン ID では、行を増やさない（窓ごとに 1 行の共通の鍵だけを増やす）。
 *    監査ログの書き込みは、いつも最後に置く。
 *  - 画面の文言は、判別共用体の error（そのまま画面に出せる日本語）を除いて、UI 側が決める。
 *
 * 既知の限界: ID ごとの上限（1 時間に 50 回）は、複数の IP から管理者を締め出すのに使える。/recover で戻せる。
 */
import { getRepositories } from "@/repositories";
import type { Repositories } from "@/repositories/types";
import {
  HOUR_WINDOW_MS,
  QUARTER_WINDOW_MS,
} from "@/repositories/auth-counters";
import {
  displayNameOf,
  normalizeLoginId,
  sessionVersionOf,
  ROLE_LABELS,
  type User,
  type UserRole,
  type UserStatus,
  type UserSummary,
} from "@/domain/user";
import {
  INVITE_TTL_MS,
  RESET_TTL_MS,
  inviteStatus,
  type Invite,
  type InviteKind,
  type InviteSummary,
} from "@/domain/invite";
import {
  bytesToB64url,
  connectionCodeMatches,
  sameText,
  type VerifiedSession,
} from "./auth.ts";
import { clientIp as readClientIp, recordAudit } from "./audit.ts";
import {
  passwordIterations,
  validateDisplayName,
  validateLoginId,
  validatePassword,
} from "./password-policy.ts";
import {
  decryptSecret,
  encryptSecret,
  recoveryCodeHmac,
  sha256Hex,
} from "./secret-box.ts";
import { qrSvg } from "./qr.ts";
import {
  RECOVERY_CODE_LENGTH,
  buildOtpauthUri,
  generateRecoveryCodes,
  generateTotpSecret,
  normalizeRecoveryCode,
  verifyTotp,
} from "./totp.ts";
import type { Session } from "./session.ts";

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}
function fail<T = never>(error: string): Result<T> {
  return { ok: false, error };
}

/** 画面に出す、ログイン失敗の共通の文言。ID の有無もロック中かどうかも分からないようにする。 */
export const LOGIN_FAILED_MESSAGE =
  "ID またはパスワードが違うか、一時的にロックされています";

const INVALID_LINK_MESSAGE = "このリンクは無効か、期限が切れています";
const RECOVER_FAILED_MESSAGE =
  "接続コード、ログイン ID が正しくないか、管理者のアカウントではありません";

export const REQUIRE_TOTP_KEY = "security.requireTotp";

// ── パスワードのハッシュ ───────────────────────────────────────────────────────
// PBKDF2-SHA256（Web Crypto）。Cloudflare Workers の無料枠（CPU 10ms/リクエスト）に収めるため、
// 反復回数の既定は 20,000。環境変数 KEIRI_PASSWORD_ITERATIONS（20,000〜100,000）で上げられる。
// その分、パスワードは 12 文字以上にして、総当たりに耐えるようにする。
// ログイン時にハッシュは作り直さない（次にパスワードを変えたとき、新しい回数になる）。
const PBKDF2_PREFIX = "pbkdf2-sha256";

/** 存在しない ID のときに計算するダミー。本物と同じ回数にして、応答の速さから ID の有無が分からないようにする。 */
function dummyHash(): string {
  return `${PBKDF2_PREFIX}$${passwordIterations()}$${"0".repeat(32)}$${"0".repeat(64)}`;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex: string): Uint8Array {
  return Uint8Array.from(hex.match(/.{2}/g) ?? [], (h) => parseInt(h, 16));
}

/** 長さが同じなら全桁を比べる（途中で止めない）。 */
export function constantTimeEqual(a: string, b: string): boolean {
  return sameText(a, b);
}

async function derive(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations },
    key,
    256,
  );
  return toHex(new Uint8Array(bits));
}

export async function hashPassword(password: string): Promise<string> {
  const iterations = passwordIterations();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt, iterations);
  return `${PBKDF2_PREFIX}$${iterations}$${toHex(salt)}$${hash}`;
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  if (!stored.startsWith(`${PBKDF2_PREFIX}$`)) return false;
  const [, iterations, salt, hash] = stored.split("$");
  const n = Number(iterations);
  if (!Number.isInteger(n) || n < 1 || !salt || !hash) return false;
  return constantTimeEqual(await derive(password, fromHex(salt), n), hash);
}

/** 紛らわしい文字を除いたランダムパスワードを生成する。 */
export function generatePassword(length = 12): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let out = "";
  for (let i = 0; i < length; i++) out += chars[bytes[i] % chars.length];
  return out;
}

// ── 要求の情報 ────────────────────────────────────────────────────────────────

/** cf-connecting-ip → x-forwarded-for の先頭 → ""。 */
export function clientIp(): Promise<string> {
  return readClientIp();
}

// ── ロック（auth_counters）────────────────────────────────────────────────────
// 試行は、照合の前に数える（成功した試行も数に入る）。
//  - loginId と IP の組で 15 分に 10 回、loginId だけで 1 時間に 50 回。IP ごとに分けるのは、
//    他人の ID をわざと間違えて締め出す嫌がらせを防ぐため。
//  - 2段階認証のコードは、パスワードを知っている人しか来られないので、IP に関係なく、ユーザーごとに 15 分に 5 回。
//    6 桁の総当たりを止める。
//  - ログイン中のパスワードの再入力（パスワード変更など）は、ユーザーごとに 15 分に 10 回。
// どれも窓が変われば自然に解ける。
const IP_LIMIT = 10;
const ALL_LIMIT = 50;
const TOTP_LIMIT = 5;
const REAUTH_LIMIT = 10;

const TOO_MANY_MESSAGE =
  "試行の回数が多すぎます。しばらく待ってから、やり直してください";

function quarter(nowMs: number): number {
  return Math.floor(nowMs / QUARTER_WINDOW_MS);
}

interface Attempt {
  /** 上限以内か。false なら、パスワードを照合せずに断る。 */
  allowed: boolean;
  /** この窓での、この ID と IP の組の何回目か。存在しない ID では 0。 */
  ipCount: number;
}

/**
 * ログインの試行を数える。存在する ID は 2 つの鍵を 1 回の通信で増やし、存在しない ID は
 * 同じ回数の通信で、窓ごとに 1 行の共通の鍵を増やす（応答の速さから ID の有無が分からないように）。
 */
async function countLoginAttempt(
  repos: Repositories,
  user: User | null,
  ip: string,
  nowMs: number,
): Promise<Attempt> {
  if (!user) {
    await repos.authCounters.nextMany([`fail:unknown:${quarter(nowMs)}`]);
    return { allowed: false, ipCount: 0 };
  }
  const [ipCount, allCount] = await repos.authCounters.nextMany([
    `fail:ip:${user.id}:${ip || "-"}:${quarter(nowMs)}`,
    `fail:all:${user.id}:${Math.floor(nowMs / HOUR_WINDOW_MS)}`,
  ]);
  const allowed = ipCount <= IP_LIMIT && allCount <= ALL_LIMIT;
  // 上限を超えた最初の 1 回だけ、監査ログに残す
  if (ipCount === IP_LIMIT + 1 || allCount === ALL_LIMIT + 1) {
    await recordAudit(
      { userId: user.id, name: user.loginId },
      "login.locked",
      { type: "user", id: user.id },
      ipCount === IP_LIMIT + 1
        ? "同じ IP からの試行が 15 分に 10 回を超えた"
        : "試行が 1 時間に 50 回を超えた",
      ip,
    );
  }
  return { allowed, ipCount };
}

/** 失敗を、窓ごとの最初の 1 回だけ監査ログに残す（毎回書くと、攻撃者が audit_log を際限なく伸ばせる）。 */
async function recordFailureOnce(
  repos: Repositories,
  user: User,
  ip: string,
  nowMs: number,
  summary: string,
): Promise<void> {
  const first = await repos.authCounters.next(
    `fail:log:${user.id}:${quarter(nowMs)}`,
  );
  if (first !== 1) return;
  await recordAudit(
    { userId: user.id, name: user.loginId },
    "login.failure",
    { type: "user", id: user.id },
    summary,
    ip,
  );
}

/** ログイン中のパスワードの再入力を、数えてから確かめる。 */
async function checkReauth(
  repos: Repositories,
  user: User,
  password: string,
): Promise<Result<void>> {
  const [count] = await repos.authCounters.nextMany([
    `fail:pw:${user.id}:${quarter(Date.now())}`,
  ]);
  if (count > REAUTH_LIMIT) return fail(TOO_MANY_MESSAGE);
  return (await passwordMatches(user, password))
    ? ok(undefined)
    : fail("パスワードが違います");
}

// ── 2段階認証の状態 ───────────────────────────────────────────────────────────

/** 有効化済みで、秘密を復号できるか。接続コードを作り直して復号できないときは「未設定」。 */
async function userHasTotp(user: User): Promise<boolean> {
  if (!user.totpSecret || !user.totpEnabledAt) return false;
  return (await decryptSecret(user.totpSecret)) !== null;
}

export async function isTotpRequired(): Promise<boolean> {
  const repos = await getRepositories();
  return (await repos.settings.get(REQUIRE_TOTP_KEY)) === "1";
}

// ── セッションの確認 ──────────────────────────────────────────────────────────

/**
 * 署名の正しい Cookie が、今も使えるかを保存済みの値で確かめる。
 * ユーザーがいない / 無効 / sv が違う / 2段階認証が必須なのに未設定、のどれかなら stale。
 */
export async function resolveSession(
  signed: Pick<VerifiedSession, "sub" | "sv">,
): Promise<{ session: Session | null; stale: boolean }> {
  const repos = await getRepositories();
  const user = await repos.users.get(signed.sub);
  const stale = { session: null, stale: true };
  if (!user || user.status !== "active") return stale;
  if (signed.sv !== sessionVersionOf(user)) return stale;
  if ((await isTotpRequired()) && !(await userHasTotp(user))) return stale;
  return {
    session: {
      sub: user.id,
      role: user.role,
      loginId: user.loginId,
      displayName: displayNameOf(user),
    },
    stale: false,
  };
}

/** 保留 Cookie を出したあとに、ユーザーの状態が変わっていないか。 */
export async function isPendingCurrent(
  userId: string,
  sv: string,
): Promise<boolean> {
  const repos = await getRepositories();
  const user = await repos.users.get(userId);
  return Boolean(
    user && user.status === "active" && sv === sessionVersionOf(user),
  );
}

// ── ログイン ──────────────────────────────────────────────────────────────────

/**
 * 旧来の呼び出し口。ログイン ID とパスワードを、保存済みのユーザーと照合するだけ（ロックと 2段階認証は見ない）。
 * 新しい画面は attemptLogin を使う。
 */
export async function verifyCredentials(
  loginId: string,
  password: string,
): Promise<{ userId: string; role: UserRole } | null> {
  const repos = await getRepositories();
  const user = await repos.users.findByLoginId(loginId);
  const ok = await verifyPassword(password, user?.passwordHash || dummyHash());
  return user && ok && user.status === "active"
    ? { userId: user.id, role: user.role }
    : null;
}

/**
 * ログイン ID とパスワードでログインを試みる。
 * 照合の前に試行を数え、上限を超えていたら、正しいパスワードでも照合せずに断る。存在しない ID では行を増やさない。
 * next は、このあと何をするか（session: セッションを付ける、totp: コードの入力、enroll: 2段階認証の設定）。
 */
export async function attemptLogin(
  loginId: string,
  password: string,
  ip: string,
): Promise<
  | { ok: true; userId: string; next: "session" | "totp" | "enroll" }
  | { ok: false }
> {
  const repos = await getRepositories();
  const nowMs = Date.now();
  const user = await repos.users.findByLoginId(loginId);
  const attempt = await countLoginAttempt(repos, user, ip, nowMs);
  if (!user) {
    // ユーザーが無いときも同じ計算をして、応答の速さから ID の有無が分からないようにする
    await verifyPassword(password, dummyHash());
    return { ok: false };
  }
  if (!attempt.allowed) return { ok: false };
  const passwordOk = await verifyPassword(
    password,
    user.passwordHash || dummyHash(),
  );
  if (!passwordOk || user.status !== "active") {
    await recordFailureOnce(repos, user, ip, nowMs, `ID: ${user.loginId}`);
    return { ok: false };
  }

  // 古い窓の行の掃除は、読み取りが 1 回要るので、窓ごとの最初の試行のときだけ行う
  if (attempt.ipCount === 1) await repos.authCounters.prune(nowMs);
  if (await userHasTotp(user))
    return { ok: true, userId: user.id, next: "totp" };
  if (await isTotpRequired()) {
    return { ok: true, userId: user.id, next: "enroll" };
  }
  await recordAudit(
    { userId: user.id, name: user.loginId },
    "login.success",
    { type: "user", id: user.id },
    "",
    ip,
  );
  return { ok: true, userId: user.id, next: "session" };
}

/** 6 桁のコードを検証し、同じコードの再利用を nextSeq で断つ。 */
async function consumeTotpCode(
  repos: Repositories,
  user: User,
  code: string,
  nowMs: number,
): Promise<boolean> {
  const secret = user.totpSecret ? await decryptSecret(user.totpSecret) : null;
  if (!secret) return false;
  const step = await verifyTotp(secret, code, nowMs);
  if (step === null) return false;
  // 使用済みのコード（保存値が step を超えている）は、書き込まずに断る。
  // nextSeq は呼ぶたびに増えるので、再利用の試みが次の正しいコードまで巻き込まないようにするため
  const key = `totp:${user.id}`;
  const { values } = await repos.authCounters.inspect([key], nowMs);
  if (values[0] > step) return false;
  // floor に合った時間ステップを渡す。返った値が step + 1 のときだけ通す（同時の二重使用は片方だけ通る）
  return (await repos.authCounters.next(key, step)) === step + 1;
}

/** 回復コードを検証し、1 回だけ使えるようにする（rc: の鍵）。使ったコードは一覧から外す。 */
async function consumeRecoveryCode(
  repos: Repositories,
  user: User,
  code: string,
): Promise<boolean> {
  const normalized = normalizeRecoveryCode(code);
  if (normalized.length !== RECOVERY_CODE_LENGTH) return false;
  const hash = await recoveryCodeHmac(user.id, normalized);
  let found = false;
  for (const stored of user.recoveryCodes) {
    if (sameText(stored, hash)) found = true;
  }
  if (!found) return false;
  const seq = await repos.authCounters.next(
    `rc:${user.id}:${hash.slice(0, 16)}`,
  );
  if (seq !== 1) return false;
  await repos.users.updateSecurity(user.id, {
    recoveryCodes: user.recoveryCodes.filter((c) => !sameText(c, hash)),
  });
  return true;
}

/**
 * パスワードのあとの 6 桁のコード、または回復コードを確かめる。
 * IP に関係なく、ユーザーごとに 15 分に 5 回まで。照合の前に数えて、超えていたら照合せずに断る。
 * 成功したら、呼び出し側が startSession を呼ぶ。
 */
export async function verifySecondFactor(
  userId: string,
  code: string,
  ip: string,
): Promise<{ ok: true; usedRecoveryCode: boolean } | { ok: false }> {
  const repos = await getRepositories();
  const nowMs = Date.now();
  const user = await repos.users.get(userId);
  if (!user || user.status !== "active") return { ok: false };
  const [count] = await repos.authCounters.nextMany([
    `fail:totp:${user.id}:${quarter(nowMs)}`,
  ]);
  const actor = { userId: user.id, name: user.loginId };
  const target = { type: "user", id: user.id };
  if (count > TOTP_LIMIT) {
    if (count === TOTP_LIMIT + 1) {
      await recordAudit(
        actor,
        "login.locked",
        target,
        "2段階認証のコードの試行が 15 分に 5 回を超えた",
        ip,
      );
    }
    return { ok: false };
  }

  const clean = code.replace(/\s/g, "");
  const isRecovery = !/^\d{6}$/.test(clean);
  const good = isRecovery
    ? await consumeRecoveryCode(repos, user, code)
    : await consumeTotpCode(repos, user, clean, nowMs);
  if (!good) {
    await recordFailureOnce(
      repos,
      user,
      ip,
      nowMs,
      "2段階認証のコードが違った",
    );
    return { ok: false };
  }

  if (isRecovery) await recordAudit(actor, "recovery.used", target, "", ip);
  await recordAudit(actor, "login.success", target, "", ip);
  return { ok: true, usedRecoveryCode: isRecovery };
}

// ── 最初の管理者、招待、再設定、復旧 ───────────────────────────────────────────

function newToken(): string {
  return bytesToB64url(crypto.getRandomValues(new Uint8Array(32)));
}

function requireAdmin(actor: Session): void {
  if (actor.role !== "admin") throw new Error("権限がありません");
}

/** 並行して同じ ID が作られたとき、先に作られた 1 つだけ残す。自分が負けたら消して true。 */
async function loseDuplicate(
  repos: Repositories,
  created: User,
): Promise<boolean> {
  const same = (await repos.users.list()).filter(
    (u) => u.loginId === created.loginId,
  );
  if (same.length < 2) return false;
  const winner = [...same].sort((a, b) =>
    a.createdAt === b.createdAt
      ? a.id.localeCompare(b.id)
      : a.createdAt.localeCompare(b.createdAt),
  )[0];
  if (winner.id === created.id) return false;
  await repos.users.remove(created.id);
  return true;
}

/** ユーザーが 0 人のときだけ、接続コードで持ち主だと確かめて、最初の管理者を作る。 */
export async function createFirstAdmin(input: {
  connectionCode: string;
  loginId: string;
  displayName: string;
  password: string;
}): Promise<Result<{ userId: string }>> {
  if (!connectionCodeMatches(input.connectionCode)) {
    return fail("接続コードが違います");
  }
  const repos = await getRepositories();
  if ((await repos.users.list()).length > 0) {
    return fail("すでにユーザーが登録されています。ログインしてください");
  }
  const loginId = normalizeLoginId(input.loginId);
  const problem =
    validateLoginId(loginId) ??
    validateDisplayName(input.displayName) ??
    validatePassword(input.password, loginId);
  if (problem) return fail(problem);

  const created = await repos.users.create({
    loginId,
    displayName: input.displayName.trim(),
    passwordHash: await hashPassword(input.password),
    role: "admin",
  });
  // 同時に 2 か所から /setup を送られたら、先に作られた 1 人だけ残す
  const others = (await repos.users.list()).filter((u) => u.id !== created.id);
  if (
    others.some(
      (u) =>
        u.createdAt < created.createdAt ||
        (u.createdAt === created.createdAt && u.id < created.id),
    )
  ) {
    await repos.users.remove(created.id);
    return fail("すでにユーザーが登録されています。ログインしてください");
  }
  await recordAudit(
    { userId: created.id, name: created.loginId },
    "user.joined",
    { type: "user", id: created.id },
    `ログイン ID: ${created.loginId}、最初の管理者を登録`,
  );
  // /setup はこの場でログイン済みにするので、ログインも残す（最終ログインの表示に使う）
  await recordAudit(
    { userId: created.id, name: created.loginId },
    "login.success",
    { type: "user", id: created.id },
  );
  return ok({ userId: created.id });
}

/** 管理者が「招待リンクを作る」。トークンは作ったときに 1 度だけ返す（保存するのはハッシュだけ）。 */
export async function createInvite(
  actor: Session,
  input: { role: UserRole; note: string },
): Promise<{ token: string; expiresAt: string; inviteId: string }> {
  requireAdmin(actor);
  const repos = await getRepositories();
  const token = newToken();
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS).toISOString();
  const note = input.note.trim().slice(0, 200);
  const invite = await repos.invites.create({
    kind: "invite",
    tokenHash: await sha256Hex(token),
    userId: "",
    role: input.role,
    note,
    createdBy: actor.sub,
    expiresAt,
  });
  await recordAudit(
    actor,
    "user.invited",
    { type: "invite", id: invite.id },
    `役割: ${ROLE_LABELS[input.role]}${note ? `、メモ: ${note}` : ""}`,
  );
  return { token, expiresAt, inviteId: invite.id };
}

/** 使えるリンクを探す。無効・期限切れ・使用済み・種類違いは、どれも同じ null。 */
async function findUsableLink(
  repos: Repositories,
  token: string,
  kind: InviteKind,
): Promise<Invite | null> {
  if (!token || token.length > 200) return null;
  const invite = await repos.invites.findByTokenHash(await sha256Hex(token));
  if (!invite || invite.kind !== kind) return null;
  return inviteStatus(invite, Date.now()) === "pending" ? invite : null;
}

/** リンクが使えるかと、画面に出す情報。無効の理由は区別しない。 */
export async function inspectLink(
  token: string,
  kind: InviteKind,
): Promise<{ valid: boolean; role?: UserRole; loginId?: string }> {
  const repos = await getRepositories();
  const invite = await findUsableLink(repos, token, kind);
  if (!invite) return { valid: false };
  if (kind === "invite") return { valid: true, role: invite.role };
  const user = await repos.users.get(invite.userId);
  return user ? { valid: true, loginId: user.loginId } : { valid: false };
}

/** 招待を受けて、ユーザーを作る。成功したら、呼び出し側が startSession を呼ぶ。 */
export async function acceptInvite(
  token: string,
  input: { loginId: string; displayName: string; password: string },
  ip: string,
): Promise<Result<{ userId: string }>> {
  const repos = await getRepositories();
  const invite = await findUsableLink(repos, token, "invite");
  if (!invite) return fail(INVALID_LINK_MESSAGE);
  const loginId = normalizeLoginId(input.loginId);
  const problem =
    validateLoginId(loginId) ??
    validateDisplayName(input.displayName) ??
    validatePassword(input.password, loginId);
  if (problem) return fail(problem);
  if (await repos.users.findByLoginId(loginId)) {
    return fail("そのログイン ID はすでに使われています");
  }
  // 書き込む前に別の通信で nextSeq を呼び、1 が返ったときだけ使える（二重使用の防止）
  if ((await repos.authCounters.next(`invite:${invite.id}`)) !== 1) {
    return fail(INVALID_LINK_MESSAGE);
  }
  const created = await repos.users.create({
    loginId,
    displayName: input.displayName.trim(),
    passwordHash: await hashPassword(input.password),
    role: invite.role,
  });
  if (await loseDuplicate(repos, created)) {
    return fail("そのログイン ID はすでに使われています");
  }
  await repos.invites.markUsed(invite.id, new Date().toISOString());
  await recordAudit(
    { userId: created.id, name: created.loginId },
    "user.joined",
    { type: "user", id: created.id },
    `ログイン ID: ${created.loginId}、役割: ${ROLE_LABELS[created.role]}`,
    ip,
  );
  // 2段階認証が必須なら /login/enroll に回り、設定が終わった時に login.success が残る。二重に残さない
  if (!(await isTotpRequired())) {
    await recordAudit(
      { userId: created.id, name: created.loginId },
      "login.success",
      { type: "user", id: created.id },
      "",
      ip,
    );
  }
  return ok({ userId: created.id });
}

/** 管理者が、ある人の「再設定リンクを作る」。 */
export async function createResetLink(
  actor: Session,
  userId: string,
): Promise<{ token: string; expiresAt: string }> {
  requireAdmin(actor);
  const repos = await getRepositories();
  const user = await repos.users.get(userId);
  if (!user) throw new Error("ユーザーが見つかりません");
  const token = newToken();
  const expiresAt = new Date(Date.now() + RESET_TTL_MS).toISOString();
  await repos.invites.create({
    kind: "reset",
    tokenHash: await sha256Hex(token),
    userId: user.id,
    role: user.role,
    note: user.loginId,
    createdBy: actor.sub,
    expiresAt,
  });
  await recordAudit(
    actor,
    "reset.issued",
    { type: "user", id: user.id },
    `対象: ${user.loginId}`,
  );
  return { token, expiresAt };
}

/** 再設定リンクで新しいパスワードを決める。本人の側の sessionVersion を上げる。2段階認証はそのまま。 */
export async function resetPasswordWithLink(
  token: string,
  password: string,
  ip: string,
): Promise<Result<{ userId: string }>> {
  const repos = await getRepositories();
  const invite = await findUsableLink(repos, token, "reset");
  const user = invite ? await repos.users.get(invite.userId) : null;
  if (!invite || !user) return fail(INVALID_LINK_MESSAGE);
  const problem = validatePassword(password, user.loginId);
  if (problem) return fail(problem);
  if ((await repos.authCounters.next(`invite:${invite.id}`)) !== 1) {
    return fail(INVALID_LINK_MESSAGE);
  }
  const nowIso = new Date().toISOString();
  await repos.users.updateSecurity(user.id, {
    passwordHash: await hashPassword(password),
    passwordChangedAt: nowIso,
    bumpSession: true,
  });
  await repos.invites.markUsed(invite.id, nowIso);
  await recordAudit(
    { userId: user.id, name: user.loginId },
    "password.reset",
    { type: "user", id: user.id },
    "",
    ip,
  );
  return ok({ userId: user.id });
}

/**
 * 管理者の復旧（/recover）。全員がログインできなくなったときの出口。
 * 接続コードが一致し、その ID が管理者なら、パスワードを入れ替え、2段階認証を解除し、ロックを解き、
 * 状態を active にし、版数を上げる。接続コードは 256 ビット級の秘密なので総当たりの対策は要らない。
 */
export async function recoverAdmin(
  input: { connectionCode: string; loginId: string; password: string },
  ip: string,
): Promise<Result<{ userId: string }>> {
  const codeOk = connectionCodeMatches(input.connectionCode);
  const repos = await getRepositories();
  const user = await repos.users.findByLoginId(input.loginId);
  if (!codeOk || !user || user.role !== "admin") {
    return fail(RECOVER_FAILED_MESSAGE);
  }
  const problem = validatePassword(input.password, user.loginId);
  if (problem) return fail(problem);

  // 接続コードを通した操作なので、user_security を書ける。状態を active に戻すのも、この復旧だけの例外
  await repos.users.updateSecurity(user.id, {
    passwordHash: await hashPassword(input.password),
    passwordChangedAt: new Date().toISOString(),
    totpSecret: "",
    totpEnabledAt: "",
    recoveryCodes: [],
    bumpSession: true,
  });
  if (user.status !== "active") {
    await repos.users.updateAccess(user.id, { status: "active" });
  }
  await repos.authCounters.deleteByPrefix(
    ["ip", "all", "totp", "pw", "log"].map(
      (kind) => `fail:${kind}:${user.id}:`,
    ),
  );
  await recordAudit(
    { userId: user.id, name: user.loginId },
    "admin.recovered",
    { type: "user", id: user.id },
    "接続コードで管理者のパスワードを入れ替えた",
    ip,
  );
  return ok({ userId: user.id });
}

// ── 本人のアカウント ──────────────────────────────────────────────────────────

async function ownUser(
  repos: Repositories,
  session: Session,
): Promise<User | null> {
  return repos.users.get(session.sub);
}

const NO_USER_MESSAGE = "ユーザーが見つかりません";

/** 今のパスワードが合っているか。 */
async function passwordMatches(user: User, password: string): Promise<boolean> {
  return verifyPassword(password, user.passwordHash || dummyHash());
}

export async function changePassword(
  session: Session,
  current: string,
  next: string,
): Promise<Result<void>> {
  const repos = await getRepositories();
  const user = await ownUser(repos, session);
  if (!user) return fail(NO_USER_MESSAGE);
  const reauth = await checkReauth(repos, user, current);
  if (!reauth.ok) {
    return fail(
      reauth.error === TOO_MANY_MESSAGE
        ? reauth.error
        : "現在のパスワードが違います",
    );
  }
  const problem = validatePassword(next, user.loginId);
  if (problem) return fail(problem);
  await repos.users.updateSecurity(user.id, {
    passwordHash: await hashPassword(next),
    passwordChangedAt: new Date().toISOString(),
    bumpSession: true,
  });
  await recordAudit(session, "password.changed", { type: "user", id: user.id });
  return ok(undefined);
}

/** 表示名の変更。Cookie だけで書けるので、user_profiles の行だけを書く（パスワードや版数は触らない）。 */
export async function changeDisplayName(
  session: Session,
  displayName: string,
): Promise<Result<void>> {
  const problem = validateDisplayName(displayName);
  if (problem) return fail(problem);
  const repos = await getRepositories();
  const user = await ownUser(repos, session);
  if (!user) return fail(NO_USER_MESSAGE);
  await repos.users.updateProfile(user.id, { displayName: displayName.trim() });
  return ok(undefined);
}

/** すべての端末からログアウトする。今の Cookie も無効になるので、続けて使うなら startSession を呼び直す。 */
export async function revokeAllSessions(session: Session): Promise<void> {
  const repos = await getRepositories();
  const user = await ownUser(repos, session);
  if (!user) return;
  await repos.users.bumpSessionVersion(user.id, "self");
  await recordAudit(session, "sessions.revoked", { type: "user", id: user.id });
}

// ── 2段階認証の設定 ───────────────────────────────────────────────────────────

type Enrollment = { secret: string; uri: string; qrSvg?: string };

function enrollmentView(loginId: string, secret: string): Enrollment {
  const uri = buildOtpauthUri(loginId, secret);
  try {
    return { secret, uri, qrSvg: qrSvg(uri) };
  } catch {
    // QR を作れなくても、手入力の秘密と URI で設定できる
    return { secret, uri };
  }
}

/**
 * ログインの途中（/login/enroll。パスワードを確かめた保留 Cookie がある）の 2段階認証の設定を始める。
 * 秘密を作って、暗号化して保留として保存する（まだ有効にしない）。保留の秘密があれば、同じものを返す。
 * すでに有効なら、先に解除が要るので例外にする。
 * アカウント画面（Cookie だけで来られる）からは、これではなく beginTotpEnrollmentWithPassword を使う。
 */
export async function beginTotpEnrollment(userId: string): Promise<Enrollment> {
  const repos = await getRepositories();
  const user = await repos.users.get(userId);
  if (!user) throw new Error(NO_USER_MESSAGE);
  if (await userHasTotp(user)) {
    throw new Error("2段階認証はすでに設定されています");
  }
  // 設定の途中（保留の秘密がある）なら、同じ秘密を返す。画面を読み込み直すたびに秘密を
  // 作り直すと、認証アプリに登録した秘密と食い違い、いつまでも確認が通らなくなる。
  const pending =
    user.totpSecret && !user.totpEnabledAt
      ? await decryptSecret(user.totpSecret)
      : null;
  const secret = pending ?? generateTotpSecret();
  if (!pending) {
    await repos.users.updateSecurity(user.id, {
      totpSecret: await encryptSecret(secret),
      totpEnabledAt: "",
      recoveryCodes: [],
    });
  }
  return enrollmentView(user.loginId, secret);
}

/**
 * アカウント画面からの 2段階認証の設定。パスワードの再入力が要る。
 * Cookie を盗んだ人が自分の認証アプリを登録して、本人を締め出すのを防ぐため。
 * 秘密は必ず作り直す（ほかの人が置いた保留の秘密を使わない）。
 */
export async function beginTotpEnrollmentWithPassword(
  session: Session,
  password: string,
): Promise<Result<Enrollment>> {
  const repos = await getRepositories();
  const user = await ownUser(repos, session);
  if (!user) return fail(NO_USER_MESSAGE);
  const reauth = await checkReauth(repos, user, password);
  if (!reauth.ok) return fail(reauth.error);
  if (await userHasTotp(user)) {
    return fail("2段階認証はすでに設定されています");
  }
  const secret = generateTotpSecret();
  await repos.users.updateSecurity(user.id, {
    totpSecret: await encryptSecret(secret),
    totpEnabledAt: "",
    recoveryCodes: [],
  });
  return ok(enrollmentView(user.loginId, secret));
}

/**
 * 今出ているコードを 1 回入れてもらって、2段階認証を有効にする。回復コード 10 個を 1 度だけ返す。
 * ログインの途中（/login/enroll）で呼ぶときは、options.login を true にして、ログイン成功も記録する。
 */
export async function confirmTotpEnrollment(
  userId: string,
  code: string,
  options?: { login?: boolean; ip?: string },
): Promise<Result<{ recoveryCodes: string[] }>> {
  const repos = await getRepositories();
  const user = await repos.users.get(userId);
  if (!user || user.status !== "active") return fail(NO_USER_MESSAGE);
  if (user.totpEnabledAt) return fail("2段階認証はすでに設定されています");
  const secret = user.totpSecret ? await decryptSecret(user.totpSecret) : null;
  if (!secret) return fail("設定をやり直してください");
  if (!(await consumeTotpCode(repos, user, code, Date.now()))) {
    return fail("コードが違います。認証アプリに出ている 6 桁を入れてください");
  }
  const codes = generateRecoveryCodes();
  await repos.users.updateSecurity(user.id, {
    totpEnabledAt: new Date().toISOString(),
    recoveryCodes: await Promise.all(
      codes.map((c) => recoveryCodeHmac(user.id, c)),
    ),
  });
  const actor = { userId: user.id, name: user.loginId };
  const target = { type: "user", id: user.id };
  await recordAudit(actor, "totp.enabled", target, "", options?.ip);
  if (options?.login) {
    await recordAudit(actor, "login.success", target, "", options.ip);
  }
  return ok({ recoveryCodes: codes });
}

/** 2段階認証を解除する。パスワードの再入力が要る。必須の間は、本人は解除できない。 */
export async function disableTotp(
  session: Session,
  password: string,
): Promise<Result<void>> {
  const repos = await getRepositories();
  const user = await ownUser(repos, session);
  if (!user) return fail(NO_USER_MESSAGE);
  const reauth = await checkReauth(repos, user, password);
  if (!reauth.ok) return reauth;
  if (await isTotpRequired()) {
    return fail("2段階認証が必須の設定になっているため、解除できません");
  }
  await repos.users.updateSecurity(user.id, {
    totpSecret: "",
    totpEnabledAt: "",
    recoveryCodes: [],
    bumpSession: true,
  });
  await recordAudit(session, "totp.disabled", { type: "user", id: user.id });
  return ok(undefined);
}

/** 回復コードを作り直す。古いものは全部無効になる。 */
export async function regenerateRecoveryCodes(
  session: Session,
  password: string,
): Promise<Result<{ recoveryCodes: string[] }>> {
  const repos = await getRepositories();
  const user = await ownUser(repos, session);
  if (!user) return fail(NO_USER_MESSAGE);
  const reauth = await checkReauth(repos, user, password);
  if (!reauth.ok) return fail(reauth.error);
  if (!(await userHasTotp(user))) {
    return fail("2段階認証が設定されていません");
  }
  const codes = generateRecoveryCodes();
  await repos.users.updateSecurity(user.id, {
    recoveryCodes: await Promise.all(
      codes.map((c) => recoveryCodeHmac(user.id, c)),
    ),
  });
  await recordAudit(session, "recovery.regenerated", {
    type: "user",
    id: user.id,
  });
  return ok({ recoveryCodes: codes });
}

// ── 管理 ──────────────────────────────────────────────────────────────────────

export async function listUsers(): Promise<UserSummary[]> {
  const repos = await getRepositories();
  const users = await repos.users.list();
  return Promise.all(
    users
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map(async (user) => ({
        id: user.id,
        loginId: user.loginId,
        displayName: displayNameOf(user),
        role: user.role,
        status: user.status,
        totpEnabled: await userHasTotp(user),
        createdAt: user.createdAt,
      })),
  );
}

/** target を除いて、有効な管理者が 1 人もいないか（target が最後の 1 人か）。 */
function isLastActiveAdmin(users: User[], target: User): boolean {
  if (target.role !== "admin" || target.status !== "active") return false;
  return !users.some(
    (u) => u.id !== target.id && u.role === "admin" && u.status === "active",
  );
}

/**
 * その人が作った、まだ使われていない招待リンクと再設定リンクを取り消す。
 * 無効にした・削除した・管理者でなくした人が、先に作っておいたリンクで、あとから入り込めないようにするため。
 */
async function revokeLinksCreatedBy(
  repos: Repositories,
  actor: Session,
  target: User,
  reason: string,
): Promise<void> {
  const open = (await repos.invites.list()).filter(
    (invite) => invite.createdBy === target.id && !invite.usedAt,
  );
  for (const invite of open) {
    await repos.invites.remove(invite.id);
    await recordAudit(
      actor,
      "invite.revoked",
      { type: "invite", id: invite.id },
      `${invite.kind === "reset" ? "再設定" : "招待"}リンクを取り消した（${target.loginId} が作ったもの。${reason}）`,
    );
  }
}

export async function setUserRole(
  actor: Session,
  userId: string,
  role: UserRole,
): Promise<Result<void>> {
  requireAdmin(actor);
  const repos = await getRepositories();
  const users = await repos.users.list();
  const target = users.find((u) => u.id === userId);
  if (!target) return fail(NO_USER_MESSAGE);
  if (target.role === role) return ok(undefined);
  if (role !== "admin" && isLastActiveAdmin(users, target)) {
    return fail("最後の 1 人の有効な管理者は、メンバーにできません");
  }
  await repos.users.updateRole(userId, role, { bumpSession: true });
  if (target.role === "admin" && role !== "admin") {
    await revokeLinksCreatedBy(repos, actor, target, "管理者でなくなったため");
  }
  await recordAudit(
    actor,
    "user.role_changed",
    { type: "user", id: userId },
    `${target.loginId}: ${ROLE_LABELS[target.role]} → ${ROLE_LABELS[role]}`,
  );
  return ok(undefined);
}

export async function setUserStatus(
  actor: Session,
  userId: string,
  status: UserStatus,
): Promise<Result<void>> {
  requireAdmin(actor);
  const repos = await getRepositories();
  const users = await repos.users.list();
  const target = users.find((u) => u.id === userId);
  if (!target) return fail(NO_USER_MESSAGE);
  if (target.status === status) return ok(undefined);
  if (status === "disabled") {
    if (target.id === actor.sub) return fail("自分自身は無効にできません");
    if (isLastActiveAdmin(users, target)) {
      return fail("最後の 1 人の有効な管理者は、無効にできません");
    }
  }
  // 無効化では sessionVersion も上げて、開いている端末を締め出す
  await repos.users.updateAccess(userId, {
    status,
    bumpSession: status === "disabled",
  });
  if (status === "disabled") {
    await revokeLinksCreatedBy(repos, actor, target, "無効にしたため");
  }
  await recordAudit(
    actor,
    status === "disabled" ? "user.disabled" : "user.enabled",
    { type: "user", id: userId },
    target.loginId,
  );
  return ok(undefined);
}

export async function deleteUser(
  actor: Session,
  userId: string,
): Promise<Result<void>> {
  requireAdmin(actor);
  const repos = await getRepositories();
  const users = await repos.users.list();
  const target = users.find((u) => u.id === userId);
  if (!target) return fail(NO_USER_MESSAGE);
  if (target.id === actor.sub) return fail("自分自身は削除できません");
  if (isLastActiveAdmin(users, target)) {
    return fail("最後の 1 人の有効な管理者は、削除できません");
  }
  await repos.users.remove(userId);
  await revokeLinksCreatedBy(repos, actor, target, "削除したため");
  await recordAudit(
    actor,
    "user.deleted",
    { type: "user", id: userId },
    target.loginId,
  );
  return ok(undefined);
}

/** 管理者が、ほかの人の 2段階認証をリセットする。その人の開いている端末は締め出される。 */
export async function resetUserTotp(
  actor: Session,
  userId: string,
): Promise<Result<void>> {
  requireAdmin(actor);
  const repos = await getRepositories();
  const target = await repos.users.get(userId);
  if (!target) return fail(NO_USER_MESSAGE);
  await repos.users.resetTotp(userId);
  await recordAudit(
    actor,
    "totp.reset",
    { type: "user", id: userId },
    target.loginId,
  );
  return ok(undefined);
}

/** 招待と再設定のリンクの一覧（新しい順）。トークンのハッシュは含まない。 */
export async function listInvites(): Promise<InviteSummary[]> {
  const repos = await getRepositories();
  const nowMs = Date.now();
  return (await repos.invites.list())
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(({ tokenHash: _hash, ...rest }) => ({
      ...rest,
      status: inviteStatus({ ...rest, tokenHash: _hash }, nowMs),
    }));
}

export async function revokeInvite(
  actor: Session,
  id: string,
): Promise<Result<void>> {
  requireAdmin(actor);
  const repos = await getRepositories();
  const invite = await repos.invites.get(id);
  if (!invite) return fail("リンクが見つかりません");
  await repos.invites.remove(id);
  await recordAudit(
    actor,
    "invite.revoked",
    { type: "invite", id },
    invite.kind === "reset" ? `再設定: ${invite.note}` : invite.note,
  );
  return ok(undefined);
}

/** 2段階認証の必須化を切り替える。操作している管理者自身が設定済みのときだけ、有効にできる（締め出しを防ぐ）。 */
export async function setRequireTotp(
  actor: Session,
  on: boolean,
): Promise<Result<void>> {
  requireAdmin(actor);
  const repos = await getRepositories();
  if (on) {
    const me = await repos.users.get(actor.sub);
    if (!me || !(await userHasTotp(me))) {
      return fail("先にご自身の 2段階認証を設定してください");
    }
  }
  await repos.settings.set(REQUIRE_TOTP_KEY, on ? "1" : "0");
  await recordAudit(
    actor,
    "security.require_totp_changed",
    { type: "setting", id: REQUIRE_TOTP_KEY },
    on ? "必須にした" : "必須をやめた",
  );
  return ok(undefined);
}
