"use client";

import type { Issuer } from "@/domain/issuer";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/ui/field";
import { FormActions, FormSection } from "@/app/_master/form-parts";

interface IssuerFormProps {
  action: (formData: FormData) => Promise<void>;
  defaultValues?: Issuer;
  cancelHref?: string;
}

export function IssuerForm({
  action,
  defaultValues,
  cancelHref = "/issuers",
}: IssuerFormProps) {
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
            placeholder="合同会社〇〇"
            required
          />
        </Field>

        <Field
          label="記載名義"
          htmlFor="signatoryName"
          className="sm:col-span-2"
        >
          <Input
            id="signatoryName"
            name="signatoryName"
            type="text"
            defaultValue={defaultValues?.signatoryName ?? ""}
            placeholder="代表取締役 〇〇 〇〇"
          />
        </Field>

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

        <Field
          label="建物名・階数"
          htmlFor="building"
          className="sm:col-span-2"
        >
          <Input
            id="building"
            name="building"
            type="text"
            defaultValue={defaultValues?.building ?? ""}
            placeholder="〇〇ビル 5F"
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

        <Field label="メールアドレス" htmlFor="email">
          <Input
            id="email"
            name="email"
            type="email"
            defaultValue={defaultValues?.email ?? ""}
            placeholder="info@example.com"
          />
        </Field>
      </FormSection>

      <FormSection title="請求・経理情報">
        <Field label="インボイス登録番号" htmlFor="registrationNumber">
          <Input
            id="registrationNumber"
            name="registrationNumber"
            type="text"
            defaultValue={defaultValues?.registrationNumber ?? ""}
            placeholder="T1234567890123"
          />
        </Field>

        <Field label="振込先" htmlFor="bankInfo" className="sm:col-span-2">
          <Textarea
            id="bankInfo"
            name="bankInfo"
            defaultValue={defaultValues?.bankInfo ?? ""}
            placeholder={"〇〇銀行 〇〇支店\n普通 1234567 カ）サンプル"}
            rows={3}
          />
        </Field>

        <label
          htmlFor="isDefault"
          className="flex items-center gap-2 text-sm text-ink sm:col-span-2"
        >
          <input
            id="isDefault"
            name="isDefault"
            type="checkbox"
            defaultChecked={defaultValues?.isDefault ?? false}
            className="size-4 rounded border-line-strong accent-ink"
          />
          既定の会社として使用する
        </label>
      </FormSection>

      <FormSection title="決算情報">
        <Field label="決算月" htmlFor="fiscalYearEndMonth">
          <Select
            id="fiscalYearEndMonth"
            name="fiscalYearEndMonth"
            defaultValue={
              defaultValues?.fiscalYearEndMonth !== undefined
                ? String(defaultValues.fiscalYearEndMonth)
                : ""
            }
          >
            <option value="">（未設定）</option>
            {Array.from({ length: 12 }, (_, i) => i + 1).map((month) => (
              <option key={month} value={String(month)}>
                {month}月
              </option>
            ))}
          </Select>
        </Field>

        <Field label="第1期の期末日" htmlFor="firstFiscalYearEnd">
          <Input
            id="firstFiscalYearEnd"
            name="firstFiscalYearEnd"
            type="date"
            defaultValue={defaultValues?.firstFiscalYearEnd ?? ""}
          />
        </Field>
      </FormSection>

      <FormActions cancelHref={cancelHref} />
    </form>
  );
}
