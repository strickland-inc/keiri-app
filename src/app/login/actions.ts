"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { sessionVersionOf } from "@/domain/user";
import { recordAudit } from "@/lib/audit";
import {
  LOGIN_FAILED_MESSAGE,
  attemptLogin,
  clientIp,
  confirmTotpEnrollment,
  resolveSession,
  verifySecondFactor,
} from "@/lib/auth-server";
import {
  clearPending,
  endSession,
  loadSession,
  readPending,
  startPending,
  startSession,
} from "@/lib/session";
import { sitePath } from "@/lib/site-path";
import { getRepositories } from "@/repositories";
import { firstIssue, pickValues, type FormState } from "./form-state";

const loginSchema = z.object({
  id: z
    .string()
    .trim()
    .min(1, LOGIN_FAILED_MESSAGE)
    .max(64, LOGIN_FAILED_MESSAGE),
  password: z
    .string()
    .min(1, LOGIN_FAILED_MESSAGE)
    .max(200, LOGIN_FAILED_MESSAGE),
  next: z.string().max(2000).catch("/"),
});

/** next を、このサイトの中のパスだけに限る。トップなら付けない。 */
function nextQuery(next: string): string {
  const safe = sitePath(next);
  return safe === "/" ? "" : `?next=${encodeURIComponent(safe)}`;
}

/** ID とパスワードで入る。失敗の文言は 1 種類（ID の有無もロック中かどうかも分からない）。 */
export async function login(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = pickValues(formData, ["id"]);
  const parsed = loginSchema.safeParse({
    id: formData.get("id"),
    password: formData.get("password"),
    next: formData.get("next") ?? "/",
  });
  if (!parsed.success) return { error: firstIssue(parsed.error), values };

  const result = await attemptLogin(
    parsed.data.id,
    parsed.data.password,
    await clientIp(),
  );
  if (!result.ok) return { error: LOGIN_FAILED_MESSAGE, values };

  if (result.next === "totp") {
    await startPending(result.userId, "totp");
    redirect(`/login/verify${nextQuery(parsed.data.next)}`);
  }
  if (result.next === "enroll") {
    await startPending(result.userId, "enroll");
    redirect(`/login/enroll${nextQuery(parsed.data.next)}`);
  }
  await startSession(result.userId);
  redirect(sitePath(parsed.data.next));
}

const verifySchema = z.object({
  code: z
    .string()
    .trim()
    .min(1, "6 桁のコード、または回復コードを入れてください")
    .max(64, "コードが長すぎます"),
  next: z.string().max(2000).catch("/"),
});

const VERIFY_FAILED_MESSAGE =
  "コードが違うか、一時的にロックされています。時間をおいて、もう一度入れてください";

/** パスワードのあとの 6 桁のコード、または回復コードを確かめて、本物のセッションにする。 */
export async function verifyCode(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const pending = await readPending("totp");
  // 保留の印が無い、または 5 分を過ぎた。最初からやり直す
  if (!pending) redirect("/login");

  const parsed = verifySchema.safeParse({
    code: formData.get("code"),
    next: formData.get("next") ?? "/",
  });
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  const result = await verifySecondFactor(
    pending.userId,
    parsed.data.code,
    await clientIp(),
  );
  if (!result.ok) return { error: VERIFY_FAILED_MESSAGE };

  await startSession(pending.userId);
  redirect(sitePath(parsed.data.next));
}

export interface EnrollState {
  error?: string;
  /** 設定が通ったときだけ入る。1 度だけ見せる。 */
  recoveryCodes?: string[];
}

const enrollSchema = z.object({
  code: z
    .string()
    .transform((value) => value.replace(/\s/g, ""))
    .pipe(
      z
        .string()
        .regex(/^\d{6}$/, "認証アプリに出ている 6 桁の数字を入れてください"),
    ),
});

/** その場の 2段階認証の設定。今出ているコードを確かめて、回復コードを返す。まだセッションは付けない。 */
export async function confirmEnroll(
  _prev: EnrollState,
  formData: FormData,
): Promise<EnrollState> {
  const pending = await readPending("enroll");
  if (!pending) redirect("/login");

  const parsed = enrollSchema.safeParse({ code: formData.get("code") ?? "" });
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  const result = await confirmTotpEnrollment(pending.userId, parsed.data.code, {
    login: true,
    ip: await clientIp(),
  });
  if (!result.ok) return { error: result.error };

  // 回復コードを控える時間が要るので、保留の印をもう 5 分延ばす
  await startPending(pending.userId, "enroll");
  return { recoveryCodes: result.value.recoveryCodes };
}

/** 回復コードを控えたあと、本物のセッションで先へ進む。設定を飛ばして入れないよう、状態を確かめる。 */
export async function finishEnroll(formData: FormData): Promise<void> {
  const pending = await readPending("enroll");
  if (!pending) redirect("/login");

  const repos = await getRepositories();
  const user = await repos.users.get(pending.userId);
  if (!user) redirect("/login");
  // 2段階認証が必須なのに未設定なら、セッションとして使えない（stale）ので通さない
  const resolved = await resolveSession({
    sub: user.id,
    sv: sessionVersionOf(user),
  });
  if (!resolved.session) redirect("/login/enroll");

  await startSession(user.id);
  const next = formData.get("next");
  redirect(sitePath(typeof next === "string" ? next : "/"));
}

/** ログアウト。誰か分かるときだけ監査ログに残す。サイドバーのボタンから呼ばれる。 */
export async function logout(): Promise<void> {
  try {
    const { session } = await loadSession();
    if (session)
      await recordAudit(session, "logout", { type: "user", id: session.sub });
  } catch {
    // スプレッドシートに届かなくても、ログアウトは通す
  }
  await endSession();
  await clearPending();
  redirect("/login");
}
