"use client";

import { useState } from "react";
import type { Party } from "@/domain/party";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Field } from "@/components/ui/field";
import { todayIso } from "@/lib/utils";

const OTHER_PARTY = "__other__";

interface RevenueFormProps {
  parties: Party[];
  action: (formData: FormData) => Promise<void>;
}

export function RevenueForm({ parties, action }: RevenueFormProps) {
  const [partyChoice, setPartyChoice] = useState<string>(OTHER_PARTY);
  const selectedParty = parties.find((p) => p.id === partyChoice);

  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
      <Field label="日付" htmlFor="revenue-date" required>
        <Input
          id="revenue-date"
          name="date"
          type="date"
          defaultValue={todayIso()}
          required
        />
      </Field>

      <Field label="取引先" htmlFor="revenue-party">
        <Select
          id="revenue-party"
          value={partyChoice}
          onChange={(e) => setPartyChoice(e.target.value)}
        >
          <option value={OTHER_PARTY}>その他（自由入力）</option>
          {parties.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
        {partyChoice !== OTHER_PARTY && (
          <>
            <input type="hidden" name="partyId" value={partyChoice} />
            <input
              type="hidden"
              name="partyName"
              value={selectedParty?.name ?? ""}
            />
          </>
        )}
      </Field>

      {partyChoice === OTHER_PARTY && (
        <Field
          label="取引先名"
          htmlFor="revenue-party-name"
          className="lg:col-span-2"
        >
          <Input
            id="revenue-party-name"
            name="partyName"
            type="text"
            placeholder="個人 山本 など"
          />
        </Field>
      )}

      <Field label="金額" htmlFor="revenue-amount" required>
        <Input
          id="revenue-amount"
          name="amount"
          type="number"
          inputMode="numeric"
          step={1}
          min={1}
          placeholder="100000"
          required
        />
      </Field>

      <Field
        label="摘要"
        htmlFor="revenue-description"
        className="lg:col-span-2"
      >
        <Input
          id="revenue-description"
          name="description"
          type="text"
          placeholder="システム開発業務 入金"
        />
      </Field>

      <Field label="出所" htmlFor="revenue-source">
        <Select id="revenue-source" name="source" defaultValue="通帳">
          <option value="通帳">通帳</option>
          <option value="手入力">手入力</option>
          <option value="請求書">請求書</option>
        </Select>
      </Field>

      <div className="flex items-end lg:col-span-6">
        <Button type="submit" variant="primary">
          追加する
        </Button>
      </div>
    </form>
  );
}
