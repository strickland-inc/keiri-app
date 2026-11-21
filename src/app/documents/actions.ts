"use server";

import { assertSession } from "@/lib/session";

import { getRepositories } from "@/repositories";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  DOCUMENT_STATUSES,
  isDocumentType,
  type DocumentStatus,
  type NewDocumentInput,
} from "@/domain/documents";
import { isIsoDate, isYen, LIMITS } from "@/domain/limits";
import { parseTaxRate } from "@/domain/money";
import {
  createDocument as createDocumentRecord,
  removeDocument as removeDocumentRecord,
  updateDocument as updateDocumentRecord,
} from "@/lib/documents/service";
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
        const item = {
          name: String(r.name ?? "").slice(0, LIMITS.line),
          quantity: Number(r.quantity ?? 1),
          unit: r.unit ? String(r.unit).slice(0, 20) : undefined,
          unitPrice: Number(r.unitPrice ?? 0),
          taxRate: parseTaxRate(String(r.taxRate ?? "0.1")),
        };
        if (!Number.isFinite(item.quantity) || Math.abs(item.quantity) > 1e6)
          throw new Error("明細の数量が不正です");
        if (!isYen(item.unitPrice))
          throw new Error("明細の単価は整数の円で入れてください");
        return item;
      });
    }
  }

  if (items.length > LIMITS.items)
    throw new Error(`明細は ${LIMITS.items} 件までです`);

  const optStr = (key: string): string | undefined => {
    const v = formData.get(key);
    if (typeof v !== "string" || !v.trim()) return undefined;
    return v.trim().slice(0, LIMITS.text);
  };
  const optDate = (key: string): string | undefined => {
    const v = optStr(key);
    if (v && !isIsoDate(v)) throw new Error("日付が不正です");
    return v;
  };
  const issueDate = String(formData.get("issueDate") ?? "");
  if (!isIsoDate(issueDate)) throw new Error("発行日が不正です");

  return {
    type,
    issuerId: String(formData.get("issuerId") ?? ""),
    partyId: String(formData.get("partyId") ?? ""),
    title: String(formData.get("title") ?? "").slice(0, LIMITS.line),
    issueDate,
    items,
    notes: String(formData.get("notes") ?? "").slice(0, LIMITS.text),
    dueDate: optDate("dueDate"),
    validUntil: optDate("validUntil"),
    paymentTerms: optStr("paymentTerms"),
    purpose: optStr("purpose"),
  };
}

export async function createDocument(formData: FormData): Promise<void> {
  await assertSession();
  const repos = await getRepositories();
  const parsed = parseInputFromFormData(formData);
  const input: NewDocumentInput = {
    ...parsed,
    issuerId: await resolveIssuerId(repos, parsed.issuerId),
  };
  if (!input.issuerId) throw new Error("会社が登録されていません");
  const doc = await createDocumentRecord(repos, input);
  revalidatePath("/documents");
  revalidatePath(`/documents/${doc.id}`);
  revalidatePath("/");
  redirect(`/documents/${doc.id}`);
}

export async function updateDocument(
  id: string,
  formData: FormData,
): Promise<void> {
  await assertSession();
  const repos = await getRepositories();
  const parsed = parseInputFromFormData(formData);
  // 編集では所属会社を動かさない。既存の帳票が別の帳簿へ移ると採番の連番が崩れる。
  const existing = await repos.documents.get(id);
  const input: NewDocumentInput = {
    ...parsed,
    issuerId:
      existing?.issuerId ?? (await resolveIssuerId(repos, parsed.issuerId)),
  };
  await updateDocumentRecord(repos, id, input);
  revalidatePath("/documents");
  revalidatePath(`/documents/${id}`);
  revalidatePath("/");
  redirect(`/documents/${id}`);
}

export async function removeDocument(id: string): Promise<void> {
  await assertSession();
  const repos = await getRepositories();
  await removeDocumentRecord(repos, id);
  revalidatePath("/documents");
  revalidatePath("/");
  redirect("/documents");
}

export async function updateDocumentStatus(
  id: string,
  status: DocumentStatus,
): Promise<void> {
  await assertSession();
  if (!DOCUMENT_STATUSES.includes(status))
    throw new Error("書類の状態が不正です");
  const repos = await getRepositories();
  await repos.documents.update(id, { status });
  revalidatePath(`/documents/${id}`);
  revalidatePath("/documents");
  revalidatePath("/");
}
