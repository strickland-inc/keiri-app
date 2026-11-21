"use client";

import { removeExpense } from "./actions";
import { ConfirmDeleteButton } from "@/app/_master/confirm-delete-button";

export function DeleteExpenseButton({ id }: { id: string }) {
  return (
    <ConfirmDeleteButton
      confirmMessage="この経費を削除しますか？この操作は取り消せません。"
      onDelete={() => removeExpense(id)}
    />
  );
}
