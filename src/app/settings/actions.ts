"use server";

import { revalidatePath } from "next/cache";
import { generateApiToken, hashApiToken } from "@/lib/api-auth";
import { assertAdmin } from "@/lib/session";
import { getRepositories } from "@/repositories";

export interface CreateTokenState {
  /** 発行したトークン。この応答でしか見せない。 */
  token?: string;
  name?: string;
  error?: string;
}

export async function createApiToken(
  _prev: CreateTokenState,
  formData: FormData,
): Promise<CreateTokenState> {
  await assertAdmin();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "名前を入れてください" };
  if (name.length > 64) return { error: "名前は 64 文字以内にしてください" };

  const token = generateApiToken();
  const repos = await getRepositories();
  await repos.apiTokens.create({ name, tokenHash: await hashApiToken(token) });
  revalidatePath("/settings");
  return { token, name };
}

export async function revokeApiToken(id: string): Promise<void> {
  await assertAdmin();
  const repos = await getRepositories();
  await repos.apiTokens.remove(id);
  revalidatePath("/settings");
}
