"use server";

import { revalidatePath } from "next/cache";
import { generateApiToken, hashApiToken } from "@/lib/api-auth";
import { recordAudit } from "@/lib/audit";
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
  const actor = await assertAdmin();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "名前を入れてください" };
  if (name.length > 64) return { error: "名前は 64 文字以内にしてください" };

  const token = generateApiToken();
  const repos = await getRepositories();
  const created = await repos.apiTokens.create({
    name,
    tokenHash: await hashApiToken(token),
  });
  // 監査ログには名前だけを残す。トークンそのものは入れない
  await recordAudit(
    actor,
    "token.created",
    { type: "api_token", id: created.id },
    `名前: ${name}`,
  );
  revalidatePath("/settings");
  return { token, name };
}

export async function revokeApiToken(id: string): Promise<void> {
  const actor = await assertAdmin();
  const repos = await getRepositories();
  const target = (await repos.apiTokens.list()).find((t) => t.id === id);
  await repos.apiTokens.remove(id);
  await recordAudit(
    actor,
    "token.revoked",
    { type: "api_token", id },
    target ? `名前: ${target.name}` : "",
  );
  revalidatePath("/settings");
}
