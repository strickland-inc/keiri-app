"use client";

import { removeIssuer } from "@/app/issuers/actions";
import { ConfirmDeleteButton } from "@/app/_master/confirm-delete-button";

export function DeleteIssuerButton({ id }: { id: string }) {
  return (
    <ConfirmDeleteButton
      confirmMessage="この会社を削除しますか？この操作は取り消せません。"
      onDelete={() => removeIssuer(id)}
    />
  );
}
