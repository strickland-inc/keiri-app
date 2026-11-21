/**
 * 今の要求のログイン情報の読み書き。
 * Server Action のファイルに置くと、ブラウザから直接呼べる関数になってしまう。
 * 誰としてログインするかを引数で受ける startSession は、必ずこのファイルに置く。
 */
import { cookies } from "next/headers";
import {
  createSession,
  isDemoMode,
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  verifySession,
} from "@/lib/auth";
import { getRepositories } from "@/repositories";

export interface Session {
  sub: string;
  role: string;
}

/** ログイン済みの印になる Cookie を付ける。資格情報を確かめたあとにだけ呼ぶ。 */
export async function startSession(
  userId: string,
  role: string,
): Promise<void> {
  const token = await createSession(userId, role);
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}

/**
 * Cookie の署名を確かめたうえで、そのユーザーがまだ users にいるかを確かめる。
 * 権限も Cookie の値ではなく、users の今の値を使う。削除や権限の変更を、その場で効かせるため。
 * stale は「署名は正しいが、ユーザーがもういない」Cookie を持っていること。
 */
export async function loadSession(): Promise<{
  session: Session | null;
  stale: boolean;
}> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const signed = await verifySession(token);
  if (!signed || isDemoMode()) return { session: signed, stale: false };
  const repos = await getRepositories();
  const user = await repos.users.get(signed.sub);
  return user
    ? { session: { sub: user.id, role: user.role }, stale: false }
    : { session: null, stale: true };
}

export async function currentSession(): Promise<Session | null> {
  return (await loadSession()).session;
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
export async function assertAdmin(): Promise<void> {
  const session = await assertSession();
  if (session.role !== "admin") throw new Error("権限がありません");
}
