"use client";

import { useActionState } from "react";
import { createManualExpense, type ManualExpenseState } from "./actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { EXPENSE_CATEGORIES } from "@/domain/expense";
import { todayIso } from "@/lib/utils";

const initialState: ManualExpenseState = { ok: false };

export function ExpenseForm() {
  const [state, action, pending] = useActionState(
    createManualExpense,
    initialState,
  );
  const values = state.values;
  const errors = state.errors ?? {};

  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="日付" htmlFor="expense-date" required error={errors.date}>
          <Input
            id="expense-date"
            name="date"
            type="date"
            defaultValue={values?.date ?? todayIso()}
            required
          />
        </Field>

        <Field
          label="利用先"
          htmlFor="expense-merchant"
          required
          error={errors.merchant}
          className="lg:col-span-2"
        >
          <Input
            id="expense-merchant"
            name="merchant"
            type="text"
            defaultValue={values?.merchant ?? ""}
            required
          />
        </Field>

        <Field
          label="金額（税込・円）"
          htmlFor="expense-amount"
          required
          error={errors.amount}
        >
          <Input
            id="expense-amount"
            name="amount"
            type="number"
            inputMode="numeric"
            step={1}
            min={1}
            defaultValue={values?.amount ?? ""}
            required
          />
        </Field>

        <Field label="費目" htmlFor="expense-category" error={errors.category}>
          <Select
            id="expense-category"
            name="category"
            defaultValue={values?.category ?? ""}
          >
            <option value="">自動判定</option>
            {EXPENSE_CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="メモ"
          htmlFor="expense-note"
          error={errors.note}
          className="sm:col-span-2 lg:col-span-3"
        >
          <Input
            id="expense-note"
            name="note"
            type="text"
            defaultValue={values?.note ?? ""}
          />
        </Field>
      </div>

      {state.ok && <Alert tone="success">追加しました</Alert>}

      <div>
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? "追加中…" : "追加する"}
        </Button>
      </div>
    </form>
  );
}
