"use server";

import { revalidatePath } from "next/cache";
import {
  createInvite,
  createResetLink,
  deleteUser,
  resetUserTotp,
  revokeInvite,
  setRequireTotp,
  setUserRole,
  setUserStatus,
} from "@/lib/auth-server";
import { assertAdmin } from "@/lib/session";
import type { UserRole } from "@/domain/user";

/** 一度だけ見せるリンク。トークンは保存されないので、この応答でしか取れない。 */
export interface IssuedLink {
  /** 例: /invite/<token>。origin は画面側（ブラウザ）が足す。 */
  path: string;
  expiresAt: string;
}

export type ActionResult =
  { ok: true; link?: IssuedLink } | { ok: false; error: string };

export interface InviteFormState {
  link?: IssuedLink;
  error?: string;
}

function parseRole(value: FormDataEntryValue | null): UserRole | null {
  return value === "admin" || value === "user" ? value : null;
}

/** 招待リンクを作る。 */
export async function createInviteAction(
  _prev: InviteFormState,
  formData: FormData,
): Promise<InviteFormState> {
  const actor = await assertAdmin();
  const role = parseRole(formData.get("role"));
  if (!role) return { error: "役割を選んでください" };
  const note = String(formData.get("note") ?? "");
  const issued = await createInvite(actor, { role, note });
  revalidatePath("/admin");
  return {
    link: { path: `/invite/${issued.token}`, expiresAt: issued.expiresAt },
  };
}

export async function revokeInviteAction(id: string): Promise<ActionResult> {
  const actor = await assertAdmin();
  const result = await revokeInvite(actor, id);
  revalidatePath("/admin");
  return result.ok ? { ok: true } : { ok: false, error: result.error };
}

export async function createResetLinkAction(
  userId: string,
): Promise<ActionResult> {
  const actor = await assertAdmin();
  try {
    const issued = await createResetLink(actor, userId);
    revalidatePath("/admin");
    return {
      ok: true,
      link: { path: `/reset/${issued.token}`, expiresAt: issued.expiresAt },
    };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error ? error.message : "リンクを作れませんでした",
    };
  }
}

export async function setRoleAction(
  userId: string,
  role: UserRole,
): Promise<ActionResult> {
  const actor = await assertAdmin();
  if (role !== "admin" && role !== "user") {
    return { ok: false, error: "役割が正しくありません" };
  }
  const result = await setUserRole(actor, userId, role);
  revalidatePath("/admin");
  return result.ok ? { ok: true } : { ok: false, error: result.error };
}

export async function setStatusAction(
  userId: string,
  status: "active" | "disabled",
): Promise<ActionResult> {
  const actor = await assertAdmin();
  if (status !== "active" && status !== "disabled") {
    return { ok: false, error: "状態が正しくありません" };
  }
  const result = await setUserStatus(actor, userId, status);
  revalidatePath("/admin");
  return result.ok ? { ok: true } : { ok: false, error: result.error };
}

export async function resetTotpAction(userId: string): Promise<ActionResult> {
  const actor = await assertAdmin();
  const result = await resetUserTotp(actor, userId);
  revalidatePath("/admin");
  return result.ok ? { ok: true } : { ok: false, error: result.error };
}

export async function deleteUserAction(userId: string): Promise<ActionResult> {
  const actor = await assertAdmin();
  const result = await deleteUser(actor, userId);
  revalidatePath("/admin");
  return result.ok ? { ok: true } : { ok: false, error: result.error };
}

/** 2段階認証の必須化を切り替える。 */
export async function setRequireTotpAction(on: boolean): Promise<ActionResult> {
  const actor = await assertAdmin();
  const result = await setRequireTotp(actor, on === true);
  revalidatePath("/admin/security");
  return result.ok ? { ok: true } : { ok: false, error: result.error };
}
