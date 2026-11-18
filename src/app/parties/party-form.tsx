"use client";

import type { Party } from "@/domain/party";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Field } from "@/components/ui/field";
import { FormActions, FormSection } from "@/app/_master/form-parts";

interface PartyFormProps {
  action: (formData: FormData) => Promise<void>;
  defaultValues?: Party;
  cancelHref?: string;
}

export function PartyForm({
  action,
  defaultValues,
  cancelHref = "/parties",
}: PartyFormProps) {
  return (
    <form action={action} className="flex flex-col gap-8">
      <FormSection title="基本情報">
        <Field
          label="会社名・屋号"
          htmlFor="name"
          required
          className="sm:col-span-2"
        >
          <Input
            id="name"
            name="name"
            type="text"
            defaultValue={defaultValues?.name ?? ""}
            placeholder="株式会社〇〇"
            required
          />
        </Field>

        <Field label="担当者名" htmlFor="contactName">
          <Input
            id="contactName"
            name="contactName"
            type="text"
            defaultValue={defaultValues?.contactName ?? ""}
            placeholder="山田 太郎"
          />
        </Field>

        <Field label="敬称" htmlFor="honorific">
          <Select
            id="honorific"
            name="honorific"
            defaultValue={defaultValues?.honorific ?? ""}
          >
            <option value="">（なし）</option>
            <option value="御中">御中</option>
            <option value="様">様</option>
          </Select>
        </Field>
      </FormSection>

      <FormSection title="住所・連絡先">
        <Field label="郵便番号" htmlFor="postalCode">
          <Input
            id="postalCode"
            name="postalCode"
            type="text"
            defaultValue={defaultValues?.postalCode ?? ""}
            placeholder="123-4567"
          />
        </Field>

        <Field label="住所" htmlFor="address" className="sm:col-span-2">
          <Input
            id="address"
            name="address"
            type="text"
            defaultValue={defaultValues?.address ?? ""}
            placeholder="東京都〇〇区〇〇 1-2-3"
          />
        </Field>

        <Field label="メールアドレス" htmlFor="email">
          <Input
            id="email"
            name="email"
            type="email"
            defaultValue={defaultValues?.email ?? ""}
            placeholder="info@example.com"
          />
        </Field>

        <Field label="電話番号" htmlFor="phone">
          <Input
            id="phone"
            name="phone"
            type="tel"
            defaultValue={defaultValues?.phone ?? ""}
            placeholder="03-1234-5678"
          />
        </Field>
      </FormSection>

      <FormSection title="その他">
        <Field label="インボイス登録番号" htmlFor="registrationNumber">
          <Input
            id="registrationNumber"
            name="registrationNumber"
            type="text"
            defaultValue={defaultValues?.registrationNumber ?? ""}
            placeholder="T1234567890123"
          />
        </Field>

        <Field label="よく使う件名" htmlFor="defaultTitle">
          <Input
            id="defaultTitle"
            name="defaultTitle"
            type="text"
            defaultValue={defaultValues?.defaultTitle ?? ""}
            placeholder="システム開発業務"
          />
        </Field>
      </FormSection>

      <FormActions cancelHref={cancelHref} />
    </form>
  );
}
