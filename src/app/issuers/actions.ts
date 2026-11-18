"use server";

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
  const repos = await getRepositories();
  const input = parseIssuerFromFormData(formData);
  await repos.issuers.create(input);
  revalidatePath("/issuers");
  redirect("/issuers");
}

export async function updateIssuer(
  id: string,
  formData: FormData,
): Promise<void> {
  const repos = await getRepositories();
  const input = parseIssuerFromFormData(formData);
  await repos.issuers.update(id, input);
  revalidatePath("/issuers");
  revalidatePath(`/issuers/${id}`);
  redirect("/issuers");
}

export async function removeIssuer(id: string): Promise<void> {
  const repos = await getRepositories();
  await repos.issuers.remove(id);
  revalidatePath("/issuers");
  redirect("/issuers");
}
