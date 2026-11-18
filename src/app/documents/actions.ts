"use server";

import { getRepositories } from "@/repositories";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  isDocumentType,
  type DocumentStatus,
  type NewDocumentInput,
} from "@/domain/documents";
import { parseTaxRate } from "@/domain/money";
import { createDocumentWithTemplate } from "@/lib/documents/create";
import { loadCompanyContext } from "@/lib/active-company";
import type { Repositories } from "@/repositories/types";

/**
 * 帳票の発行元は、フォームの値ではなく「今見ている会社」で決める。
 * 画面に出していない値を信用すると、切替中の会社と違う帳簿へ紛れ込み、
 * 作った直後に一覧から消えたように見えてしまう。
 */
async function resolveIssuerId(
  repos: Repositories,
  fallback: string,
): Promise<string> {
  const company = await loadCompanyContext(repos);
  return company.active?.id ?? fallback;
}

function parseInputFromFormData(formData: FormData): NewDocumentInput {
  const type = String(formData.get("type") ?? "invoice");
  if (!isDocumentType(type)) throw new Error("書類の種類が不正です");

  const itemsJson = formData.get("itemsJson");
  let items: NewDocumentInput["items"] = [];
  if (typeof itemsJson === "string" && itemsJson) {
    const raw: unknown = JSON.parse(itemsJson);
    if (Array.isArray(raw)) {
      items = raw.map((it: unknown) => {
        if (typeof it !== "object" || it === null)
          throw new Error("明細データ不正");
        const r = it as Record<string, unknown>;
        return {
          name: String(r.name ?? ""),
          quantity: Number(r.quantity ?? 1),
          unit: r.unit ? String(r.unit) : undefined,
          unitPrice: Number(r.unitPrice ?? 0),
          taxRate: parseTaxRate(String(r.taxRate ?? "0.1")),
        };
      });
    }
  }

  const optStr = (key: string): string | undefined => {
    const v = formData.get(key);
    if (typeof v !== "string" || !v.trim()) return undefined;
    return v.trim();
  };

  return {
    type,
    issuerId: String(formData.get("issuerId") ?? ""),
    partyId: String(formData.get("partyId") ?? ""),
    title: String(formData.get("title") ?? ""),
    issueDate: String(formData.get("issueDate") ?? ""),
    items,
    notes: String(formData.get("notes") ?? ""),
    dueDate: optStr("dueDate"),
    validUntil: optStr("validUntil"),
    paymentTerms: optStr("paymentTerms"),
    purpose: optStr("purpose"),
  };
}

export async function createDocument(formData: FormData): Promise<void> {
  const repos = await getRepositories();
  const parsed = parseInputFromFormData(formData);
  const input: NewDocumentInput = {
    ...parsed,
    issuerId: await resolveIssuerId(repos, parsed.issuerId),
  };
  if (!input.issuerId) throw new Error("会社が登録されていません");
  const doc = await createDocumentWithTemplate(repos, input);
  revalidatePath("/documents");
  revalidatePath(`/documents/${doc.id}`);
  revalidatePath("/");
  redirect(`/documents/${doc.id}`);
}

export async function updateDocument(
  id: string,
  formData: FormData,
): Promise<void> {
  const repos = await getRepositories();
  const parsed = parseInputFromFormData(formData);
  // 編集では所属会社を動かさない。既存の帳票が別の帳簿へ移ると採番の連番が崩れる。
  const existing = await repos.documents.get(id);
  const input: NewDocumentInput = {
    ...parsed,
    issuerId:
      existing?.issuerId ?? (await resolveIssuerId(repos, parsed.issuerId)),
  };
  await repos.documents.update(id, input);
  revalidatePath("/documents");
  revalidatePath(`/documents/${id}`);
  revalidatePath("/");
  redirect(`/documents/${id}`);
}

export async function removeDocument(id: string): Promise<void> {
  const repos = await getRepositories();
  await repos.documents.remove(id);
  revalidatePath("/documents");
  revalidatePath("/");
  redirect("/documents");
}

export async function updateDocumentStatus(
  id: string,
  status: DocumentStatus,
): Promise<void> {
  const repos = await getRepositories();
  await repos.documents.update(id, { status });
  revalidatePath(`/documents/${id}`);
  revalidatePath("/documents");
  revalidatePath("/");
}
