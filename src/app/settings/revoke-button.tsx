"use client";

import { ConfirmDeleteButton } from "@/app/_master/confirm-delete-button";
import { revokeApiToken } from "./actions";

export function RevokeTokenButton({ id, name }: { id: string; name: string }) {
  return (
    <ConfirmDeleteButton
      confirmMessage={`「${name}」を削除しますか？ このトークンを使っているプログラムは、API を呼べなくなります。`}
      onDelete={() => revokeApiToken(id)}
    />
  );
}
