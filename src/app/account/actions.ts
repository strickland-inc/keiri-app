"use server";

import { revalidatePath } from "next/cache";
import {
  beginTotpEnrollmentWithPassword,
  changeDisplayName,
  changePassword,
  confirmTotpEnrollment,
  disableTotp,
  regenerateRecoveryCodes,
  revokeAllSessions,
} from "@/lib/auth-server";
import { assertSession, startSession } from "@/lib/session";

export interface AccountState {
  ok?: boolean;
  message?: string;
  error?: string;
  /** 回復コード。作った時に 1 度だけ返す。 */
  recoveryCodes?: string[];
}

export interface EnrollmentState {
  error?: string;
  /** 手入力用の秘密。保存はされるが、画面に出すのはこの応答だけ。 */
  secret?: string;
  qrSvg?: string;
}

const fail = (error: string): AccountState => ({ ok: false, error });
const text = (formData: FormData, name: string) =>
  String(formData.get(name) ?? "");

export async function changeDisplayNameAction(
  _prev: AccountState,
  formData: FormData,
): Promise<AccountState> {
  const session = await assertSession();
  const result = await changeDisplayName(
    session,
    text(formData, "displayName"),
  );
  if (!result.ok) return fail(result.error);
  revalidatePath("/", "layout");
  return { ok: true, message: "表示名を変えました" };
}

export async function changePasswordAction(
  _prev: AccountState,
  formData: FormData,
): Promise<AccountState> {
  const session = await assertSession();
  const next = text(formData, "next");
  if (next !== text(formData, "confirm")) {
    return fail("新しいパスワードが、確認の入力と合っていません");
  }
  const result = await changePassword(session, text(formData, "current"), next);
  if (!result.ok) return fail(result.error);
  // 変更で今の Cookie も無効になるので、この端末だけ入り直す
  await startSession(session.sub);
  revalidatePath("/", "layout");
  return {
    ok: true,
    message: "パスワードを変えました。ほかの端末はログアウトされました",
  };
}

/** 2段階認証の設定を始める。パスワードを確かめて、秘密と QR を返す（まだ有効にはならない）。 */
export async function beginEnrollmentAction(
  password: string,
): Promise<EnrollmentState> {
  const session = await assertSession();
  const result = await beginTotpEnrollmentWithPassword(session, password);
  if (!result.ok) return { error: result.error };
  return { secret: result.value.secret, qrSvg: result.value.qrSvg };
}

export async function confirmEnrollmentAction(
  _prev: AccountState,
  formData: FormData,
): Promise<AccountState> {
  const session = await assertSession();
  const result = await confirmTotpEnrollment(
    session.sub,
    text(formData, "code").replace(/\s/g, ""),
  );
  if (!result.ok) return fail(result.error);
  revalidatePath("/account");
  return {
    ok: true,
    message: "2段階認証を設定しました",
    recoveryCodes: result.value.recoveryCodes,
  };
}

export async function disableTotpAction(
  _prev: AccountState,
  formData: FormData,
): Promise<AccountState> {
  const session = await assertSession();
  const result = await disableTotp(session, text(formData, "password"));
  if (!result.ok) return fail(result.error);
  await startSession(session.sub);
  revalidatePath("/account");
  return { ok: true, message: "2段階認証を解除しました" };
}

export async function regenerateCodesAction(
  _prev: AccountState,
  formData: FormData,
): Promise<AccountState> {
  const session = await assertSession();
  const result = await regenerateRecoveryCodes(
    session,
    text(formData, "password"),
  );
  if (!result.ok) return fail(result.error);
  return {
    ok: true,
    message: "回復コードを作り直しました。古いコードは使えません",
    recoveryCodes: result.value.recoveryCodes,
  };
}

export async function revokeAllSessionsAction(): Promise<AccountState> {
  const session = await assertSession();
  try {
    await revokeAllSessions(session);
    await startSession(session.sub);
  } catch (error) {
    return fail(
      error instanceof Error ? error.message : "ログアウトできませんでした",
    );
  }
  revalidatePath("/account");
  return { ok: true, message: "ほかのすべての端末をログアウトしました" };
}
