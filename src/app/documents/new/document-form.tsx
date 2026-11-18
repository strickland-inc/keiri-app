"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  DOCUMENT_TYPES,
  DOCUMENT_TYPE_LABELS,
  type DocumentType,
  type DocumentRecord,
} from "@/domain/documents";
import { todayIso } from "@/lib/utils";
import type { Party } from "@/domain/party";
import type { Issuer } from "@/domain/issuer";
import { Alert } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardBody, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/ui/field";
import { AiOrbPanel } from "@/components/ui/ai-orb-panel";
import { parseTaxRate } from "@/domain/money";
import {
  draftToLineItem,
  emptyLineItem,
  LineItemsEditor,
  toLineItemDraft,
  type LineItemDraft,
} from "./line-items-editor";

interface DocumentFormProps {
  parties: Party[];
  /** この帳票が属する会社。新規は選択中の会社、編集は帳票が既に属している会社。 */
  company: Issuer | null;
  action: (formData: FormData) => Promise<void>;
  defaultValues?: DocumentRecord;
  /** 新規作成時の書類の種類（一覧のタブから開いたとき）。 */
  initialType?: DocumentType;
}

export function DocumentForm({
  parties,
  company,
  action,
  defaultValues,
  initialType,
}: DocumentFormProps) {
  const [type, setType] = useState<DocumentType>(
    defaultValues?.type ?? initialType ?? "invoice",
  );
  const [items, setItems] = useState<LineItemDraft[]>(
    defaultValues?.items?.map(toLineItemDraft) ?? [emptyLineItem()],
  );
  const [title, setTitle] = useState(defaultValues?.title ?? "");
  const [notes, setNotes] = useState(defaultValues?.notes ?? "");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // AI見積もりアシスト
  const [aiDescription, setAiDescription] = useState("");
  const [aiPending, setAiPending] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    fd.set("itemsJson", JSON.stringify(items.map(draftToLineItem)));
    startTransition(async () => {
      try {
        await action(fd);
      } catch (err: unknown) {
        if (
          err instanceof Error &&
          err.message !== "NEXT_REDIRECT" &&
          !err.message.startsWith("NEXT_")
        ) {
          setError(err.message);
        }
      }
    });
  }

  function updateItem(index: number, patch: Partial<LineItemDraft>) {
    setItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    );
  }

  function addItem() {
    setItems((prev) => [...prev, emptyLineItem()]);
  }

  function removeItem(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }

  async function runAi() {
    setAiError(null);
    setAiPending(true);
    try {
      const res = await fetch("/api/ai/estimate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: aiDescription,
          documentType: type,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "生成に失敗しました");
      if (typeof data.title === "string" && data.title) setTitle(data.title);
      if (Array.isArray(data.items) && data.items.length > 0) {
        setItems(
          data.items.map(
            (it: {
              name?: unknown;
              quantity?: unknown;
              unit?: unknown;
              unitPrice?: unknown;
              taxRate?: unknown;
            }): LineItemDraft => ({
              name: String(it.name ?? ""),
              quantity: String(Number(it.quantity) || 1),
              unit: String(it.unit ?? ""),
              unitPrice: String(Math.round(Number(it.unitPrice) || 0)),
              taxRate: parseTaxRate(String(it.taxRate ?? 0.1)),
            }),
          ),
        );
      }
      if (typeof data.notes === "string" && data.notes) setNotes(data.notes);
    } catch (e: unknown) {
      setAiError(e instanceof Error ? e.message : "生成に失敗しました");
    } finally {
      setAiPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      {error && <Alert tone="danger">{error}</Alert>}

      {/* AI見積もりアシスト */}
      <AiOrbPanel
        value={aiDescription}
        onChange={setAiDescription}
        onSubmit={runAi}
        pending={aiPending}
        error={aiError}
      />

      {/* 基本情報 */}
      <Card>
        <CardBody className="flex flex-col gap-5 p-6">
          <CardTitle title="基本情報" />
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="書類の種類" htmlFor="type" required>
              <Select
                id="type"
                name="type"
                value={type}
                onChange={(e) => setType(e.target.value as DocumentType)}
                required
              >
                {DOCUMENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {DOCUMENT_TYPE_LABELS[t]}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="発行日" htmlFor="issueDate" required>
              <Input
                id="issueDate"
                name="issueDate"
                type="date"
                defaultValue={defaultValues?.issueDate ?? todayIso()}
                required
              />
            </Field>

            {/*
              発行元はここでは選ばせない。書類はサイドバーで選んだ会社の帳簿に入り、
              採番もその会社の連番になる。別の会社で出すなら会社を切り替えてから作る。
            */}
            <Field label="発行元" htmlFor="issuerName">
              <Input
                id="issuerName"
                type="text"
                value={company?.name ?? "会社が未登録です"}
                readOnly
                aria-readonly="true"
              />
              <input
                type="hidden"
                name="issuerId"
                value={company?.id ?? defaultValues?.issuerId ?? ""}
              />
            </Field>

            <Field label="取引先" htmlFor="partyId" required>
              <Select
                id="partyId"
                name="partyId"
                defaultValue={defaultValues?.partyId ?? parties[0]?.id ?? ""}
                required
              >
                {parties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field
              label="件名"
              htmlFor="title"
              required
              className="sm:col-span-2"
            >
              <Input
                id="title"
                name="title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="例：システム開発業務"
                required
              />
            </Field>
          </div>
        </CardBody>
      </Card>

      {/* 書類の種類ごとの項目 */}
      {(type === "invoice" || type === "quote" || type === "receipt") && (
        <Card>
          <CardBody className="flex flex-col gap-5 p-6">
            <CardTitle title={`${DOCUMENT_TYPE_LABELS[type]}の詳細`} />
            <div className="grid gap-5 sm:grid-cols-2">
              {type === "invoice" && (
                <Field label="支払期日" htmlFor="dueDate">
                  <Input
                    id="dueDate"
                    name="dueDate"
                    type="date"
                    defaultValue={defaultValues?.dueDate ?? ""}
                  />
                </Field>
              )}
              {type === "quote" && (
                <>
                  <Field label="有効期限" htmlFor="validUntil">
                    <Input
                      id="validUntil"
                      name="validUntil"
                      type="date"
                      defaultValue={defaultValues?.validUntil ?? ""}
                    />
                  </Field>
                  <Field label="支払条件" htmlFor="paymentTerms">
                    <Input
                      id="paymentTerms"
                      name="paymentTerms"
                      type="text"
                      defaultValue={defaultValues?.paymentTerms ?? ""}
                      placeholder="例：月末締め翌月末払い"
                    />
                  </Field>
                </>
              )}
              {type === "receipt" && (
                <Field
                  label="但し書き"
                  htmlFor="purpose"
                  className="sm:col-span-2"
                >
                  <Input
                    id="purpose"
                    name="purpose"
                    type="text"
                    defaultValue={defaultValues?.purpose ?? ""}
                    placeholder="例：システム開発業務として"
                  />
                </Field>
              )}
            </div>
          </CardBody>
        </Card>
      )}

      {/* 明細 */}
      <LineItemsEditor
        items={items}
        onUpdate={updateItem}
        onAdd={addItem}
        onRemove={removeItem}
      />

      {/* 備考 */}
      <Card>
        <CardBody className="p-6">
          <Field label="備考" htmlFor="notes">
            <Textarea
              id="notes"
              name="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="振込先、注意事項など"
              rows={4}
            />
          </Field>
        </CardBody>
      </Card>

      {/* 送信 */}
      <div className="flex justify-end gap-3">
        <Link
          href="/documents"
          className={buttonVariants({ variant: "secondary" })}
        >
          キャンセル
        </Link>
        <Button type="submit" variant="primary" disabled={isPending}>
          {isPending ? "保存中…" : "保存する"}
        </Button>
      </div>
    </form>
  );
}
