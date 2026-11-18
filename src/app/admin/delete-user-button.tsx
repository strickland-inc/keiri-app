"use client";

import { removeUser } from "./actions";
import { ConfirmDeleteButton } from "@/app/_master/confirm-delete-button";

export function DeleteUserButton({ id }: { id: string }) {
  return (
    <ConfirmDeleteButton
      confirmMessage="このユーザーを削除しますか？ログインできなくなります。"
      onDelete={() => removeUser(id)}
    />
  );
}
