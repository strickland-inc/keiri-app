"use server";

import { assertSession } from "@/lib/session";
import { recordAudit } from "@/lib/audit";

import { getRepositories } from "@/repositories";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { NewPartyInput } from "@/domain/party";

function parsePartyFromFormData(formData: FormData): NewPartyInput {
  const honorificRaw = formData.get("honorific");
  const honorific =
    honorificRaw === "御中" || honorificRaw === "様" ? honorificRaw : undefined;

  const optStr = (key: string): string | undefined => {
    const v = formData.get(key);
    if (typeof v !== "string" || !v.trim()) return undefined;
    return v.trim();
  };

  return {
    name: String(formData.get("name") ?? "").trim(),
    honorific,
    contactName: optStr("contactName"),
    postalCode: optStr("postalCode"),
    address: optStr("address"),
    email: optStr("email"),
    phone: optStr("phone"),
    registrationNumber: optStr("registrationNumber"),
    defaultTitle: optStr("defaultTitle"),
  };
}

export async function createParty(formData: FormData): Promise<void> {
  const session = await assertSession();
  const repos = await getRepositories();
  const input = parsePartyFromFormData(formData);
  const created = await repos.parties.create(input);
  await recordAudit(
    session,
    "party.created",
    { type: "party", id: created.id },
    `取引先「${input.name}」を登録`,
  );
  revalidatePath("/parties");
  redirect("/parties");
}

export async function updateParty(
  id: string,
  formData: FormData,
): Promise<void> {
  const session = await assertSession();
  const repos = await getRepositories();
  const input = parsePartyFromFormData(formData);
  await repos.parties.update(id, input);
  await recordAudit(
    session,
    "party.updated",
    { type: "party", id },
    `取引先「${input.name}」を更新`,
  );
  revalidatePath("/parties");
  revalidatePath(`/parties/${id}`);
  redirect("/parties");
}

export async function removeParty(id: string): Promise<void> {
  const session = await assertSession();
  const repos = await getRepositories();
  const existing = await repos.parties.get(id);
  await repos.parties.remove(id);
  await recordAudit(
    session,
    "party.deleted",
    { type: "party", id },
    `取引先「${existing?.name ?? id}」を削除`,
  );
  revalidatePath("/parties");
  redirect("/parties");
}
