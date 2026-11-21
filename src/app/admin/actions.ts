"use server";

import { getRepositories } from "@/repositories";
import { hashPassword, generatePassword } from "@/lib/auth-server";
import { assertAdmin } from "@/lib/session";
import { revalidatePath } from "next/cache";

export interface CreateUserState {
  ok: boolean;
  loginId?: string;
  password?: string;
  error?: string;
}

export async function createUser(
  _prev: CreateUserState,
  formData: FormData,
): Promise<CreateUserState> {
  await assertAdmin();
  const loginId = String(formData.get("loginId") ?? "").trim();
  if (!loginId) return { ok: false, error: "ログインIDを入力してください" };

  const repos = await getRepositories();
  if (await repos.users.findByLoginId(loginId)) {
    return { ok: false, error: "そのIDは既に使われています" };
  }

  const password = generatePassword(12);
  const passwordHash = await hashPassword(password);
  await repos.users.create({ loginId, passwordHash, role: "user" });
  revalidatePath("/admin");
  return { ok: true, loginId, password };
}

export async function removeUser(id: string): Promise<void> {
  await assertAdmin();
  const repos = await getRepositories();
  await repos.users.remove(id);
  revalidatePath("/admin");
}
