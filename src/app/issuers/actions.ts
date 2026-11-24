"use server";

import { assertSession } from "@/lib/session";
import { recordAudit } from "@/lib/audit";

import { getRepositories } from "@/repositories";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { NewIssuerInput } from "@/domain/issuer";

function parseIssuerFromFormData(formData: FormData): NewIssuerInput {
  const optStr = (key: string): string | undefined => {
    const v = formData.get(key);
    if (typeof v !== "string" || !v.trim()) return undefined;
    return v.trim();
  };

  const fiscalYearEndMonthRaw = optStr("fiscalYearEndMonth");
  const fiscalYearEndMonthNum = fiscalYearEndMonthRaw
    ? Number(fiscalYearEndMonthRaw)
    : NaN;
  const fiscalYearEndMonth =
    Number.isInteger(fiscalYearEndMonthNum) &&
    fiscalYearEndMonthNum >= 1 &&
    fiscalYearEndMonthNum <= 12
      ? fiscalYearEndMonthNum
      : undefined;

  return {
    name: String(formData.get("name") ?? "").trim(),
    signatoryName: optStr("signatoryName"),
    postalCode: optStr("postalCode"),
    address: optStr("address"),
    building: optStr("building"),
    phone: optStr("phone"),
    email: optStr("email"),
    registrationNumber: optStr("registrationNumber"),
    bankInfo: optStr("bankInfo"),
    isDefault: formData.get("isDefault") === "on",
    fiscalYearEndMonth,
    firstFiscalYearEnd: optStr("firstFiscalYearEnd"),
  };
}

export async function createIssuer(formData: FormData): Promise<void> {
  const session = await assertSession();
  const repos = await getRepositories();
  const input = parseIssuerFromFormData(formData);
  const created = await repos.issuers.create(input);
  await recordAudit(
    session,
    "issuer.created",
    { type: "issuer", id: created.id },
    `発行元「${input.name}」を登録`,
  );
  revalidatePath("/issuers");
  redirect("/issuers");
}

export async function updateIssuer(
  id: string,
  formData: FormData,
): Promise<void> {
  const session = await assertSession();
  const repos = await getRepositories();
  const input = parseIssuerFromFormData(formData);
  await repos.issuers.update(id, input);
  await recordAudit(
    session,
    "issuer.updated",
    { type: "issuer", id },
    `発行元「${input.name}」を更新`,
  );
  revalidatePath("/issuers");
  revalidatePath(`/issuers/${id}`);
  redirect("/issuers");
}

export async function removeIssuer(id: string): Promise<void> {
  const session = await assertSession();
  const repos = await getRepositories();
  const existing = await repos.issuers.get(id);
  await repos.issuers.remove(id);
  await recordAudit(
    session,
    "issuer.deleted",
    { type: "issuer", id },
    `発行元「${existing?.name ?? id}」を削除`,
  );
  revalidatePath("/issuers");
  redirect("/issuers");
}
