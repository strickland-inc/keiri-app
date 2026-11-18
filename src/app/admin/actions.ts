"use server";

import { getRepositories } from "@/repositories";
import { hashPassword, generatePassword } from "@/lib/auth-server";
import { verifySession, SESSION_COOKIE } from "@/lib/auth";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";

async function assertAdmin(): Promise<void> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  if (!session || session.role !== "admin") {
    throw new Error("権限がありません");
  }
}

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
