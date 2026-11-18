"use server";

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
  const repos = await getRepositories();
  const input = parsePartyFromFormData(formData);
  await repos.parties.create(input);
  revalidatePath("/parties");
  redirect("/parties");
}

export async function updateParty(
  id: string,
  formData: FormData,
): Promise<void> {
  const repos = await getRepositories();
  const input = parsePartyFromFormData(formData);
  await repos.parties.update(id, input);
  revalidatePath("/parties");
  revalidatePath(`/parties/${id}`);
  redirect("/parties");
}

export async function removeParty(id: string): Promise<void> {
  const repos = await getRepositories();
  await repos.parties.remove(id);
  revalidatePath("/parties");
  redirect("/parties");
}
