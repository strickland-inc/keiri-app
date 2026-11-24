"use client";

import { removeParty } from "@/app/parties/actions";
import { ConfirmDeleteButton } from "@/app/_master/confirm-delete-button";

export function DeletePartyButton({ id }: { id: string }) {
  return (
    <ConfirmDeleteButton
      confirmMessage="この取引先を削除しますか？"
      onDelete={() => removeParty(id)}
    />
  );
}
