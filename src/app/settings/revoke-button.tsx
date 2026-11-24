"use client";

import { ConfirmDeleteButton } from "@/app/_master/confirm-delete-button";
import { revokeApiToken } from "./actions";

export function RevokeTokenButton({ id, name }: { id: string; name: string }) {
  return (
    <ConfirmDeleteButton
      confirmMessage={`「${name}」を削除しますか？`}
      onDelete={() => revokeApiToken(id)}
    />
  );
}
