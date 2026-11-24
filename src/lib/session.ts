/**
 * 今の要求のログイン情報の読み書き。
 * Server Action のファイルに置くと、ブラウザから直接呼べる関数になってしまう。
 * 誰としてログインするかを引数で受ける startSession は、必ずこのファイルに置く。
 */
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  PENDING_COOKIE,
  PENDING_MAX_AGE,
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  createPending,
  createSession,
  isDemoMode,
  verifyPending,
  verifySession,
  type PendingPurpose,
} from "@/lib/auth";
import { sessionVersionOf, type UserRole } from "@/domain/user";
import { getRepositories } from "@/repositories";
import { isPendingCurrent, resolveSession } from "@/lib/auth-server";

export interface Session {
  sub: string;
  role: UserRole;
  loginId: string;
  displayName: string;
}

const DEMO_SESSION_USER: Session = {
  sub: "demo",
  role: "admin",
  loginId: "demo",
  displayName: "デモ",
};

/** ログイン済みの印になる Cookie を付ける。資格情報を確かめたあとにだけ呼ぶ。今の sv で付ける。 */
export async function startSession(userId: string): Promise<void> {
  const repos = await getRepositories();
  const user = await repos.users.get(userId);
  if (!user || user.status !== "active") {
    throw new Error("ログインできないユーザーです");
  }
  const token = await createSession(user.id, user.role, sessionVersionOf(user));
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  // 保留の印は、本物のセッションになったら不要
  store.delete({ name: PENDING_COOKIE, path: "/login" });
}

/** ログアウト。セッションの Cookie と保留 Cookie を消す。 */
export async function endSession(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  store.delete({ name: PENDING_COOKIE, path: "/login" });
}

/** 2段階認証の入力待ち、または設定待ちの印（5 分）を付ける。パスワードを確かめたあとにだけ呼ぶ。 */
export async function startPending(
  userId: string,
  purpose: PendingPurpose,
): Promise<void> {
  const repos = await getRepositories();
  const user = await repos.users.get(userId);
  if (!user || user.status !== "active") {
    throw new Error("ログインできないユーザーです");
  }
  const token = await createPending(user.id, purpose, sessionVersionOf(user));
  const store = await cookies();
  store.set(PENDING_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    // /login/verify と /login/enroll にだけ送られる
    path: "/login",
    maxAge: PENDING_MAX_AGE,
  });
}

/** 保留 Cookie が有効なら、そのユーザー。無効、期限切れ、purpose 違い、ユーザーの状態が変わっていれば null。 */
export async function readPending(
  purpose: PendingPurpose,
): Promise<{ userId: string } | null> {
  const token = (await cookies()).get(PENDING_COOKIE)?.value;
  const pending = await verifyPending(token, purpose);
  if (!pending) return null;
  return (await isPendingCurrent(pending.sub, pending.sv))
    ? { userId: pending.sub }
    : null;
}

export async function clearPending(): Promise<void> {
  (await cookies()).delete({ name: PENDING_COOKIE, path: "/login" });
}

/**
 * Cookie の署名を確かめたうえで、そのユーザーが今も使えるかを、保存済みの値で確かめる。
 * 権限も Cookie の値ではなく、保存済みの今の値を使う。削除・無効化・権限の変更を、その場で効かせるため。
 * stale は「署名は正しいが、もう使えない」Cookie を持っていること（ユーザーがいない、無効、sv が違う、
 * 2段階認証が必須なのに未設定）。
 */
export async function loadSession(): Promise<{
  session: Session | null;
  stale: boolean;
}> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const signed = await verifySession(token);
  if (!signed) return { session: null, stale: false };
  if (isDemoMode()) return { session: DEMO_SESSION_USER, stale: false };
  return resolveSession(signed);
}

export async function currentSession(): Promise<Session | null> {
  return (await loadSession()).session;
}

/**
 * 業務画面（page.tsx）の最初で呼ぶ。有効な Session を返し、無効なら画面を出さずに移す。
 * stale（無効にされた、削除された、版が変わった）は /logout、未ログインは /login。
 * 接続コード無しのデモ（ログインなし）では、デモのセッションを返す。
 * root layout だけに頼らず、各ページで呼ぶ。画面間の移動では layout が描き直されないので、
 * 無効にされた人が、開いたままの画面でデータを読み続けられてしまうため。
 */
export async function requirePageSession(): Promise<Session> {
  const { session, stale } = await loadSession();
  if (session) return session;
  redirect(stale ? "/logout" : "/login");
}

/**
 * ログインしていなければ例外にする。Server Action の最初に呼ぶ。
 * Server Action はどのページへの POST からも呼べるので、proxy の確認だけに頼らない。
 */
export async function assertSession(): Promise<Session> {
  const session = await currentSession();
  if (!session) throw new Error("ログインしてください");
  return session;
}

/** 管理者でなければ例外にする。管理者だけの Server Action の最初に呼ぶ。 */
export async function assertAdmin(): Promise<Session> {
  const session = await assertSession();
  if (session.role !== "admin") throw new Error("権限がありません");
  return session;
}
