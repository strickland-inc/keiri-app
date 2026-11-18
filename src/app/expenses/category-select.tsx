"use client";

import { useTransition } from "react";
import { Select } from "@/components/ui/select";
import { EXPENSE_CATEGORIES, type ExpenseCategory } from "@/domain/expense";
import { updateExpenseCategory } from "./actions";

interface CategorySelectProps {
  id: string;
  currentCategory: ExpenseCategory;
}

export function CategorySelect({ id, currentCategory }: CategorySelectProps) {
  const [isPending, startTransition] = useTransition();

  return (
    <Select
      value={currentCategory}
      disabled={isPending}
      onChange={(e) => {
        const next = e.target.value;
        startTransition(() => updateExpenseCategory(id, next));
      }}
    >
      {EXPENSE_CATEGORIES.map((cat) => (
        <option key={cat} value={cat}>
          {cat}
        </option>
      ))}
    </Select>
  );
}
