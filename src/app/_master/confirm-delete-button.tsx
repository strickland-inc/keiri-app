"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";

/** 確認ダイアログつきの削除ボタン。削除そのものは呼び出し側が渡す Server Action。 */
export function ConfirmDeleteButton({
  confirmMessage,
  onDelete,
}: {
  confirmMessage: string;
  onDelete: () => Promise<void>;
}) {
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    if (!confirm(confirmMessage)) return;
    startTransition(onDelete);
  }

  return (
    <Button
      variant="danger"
      size="sm"
      onClick={handleClick}
      disabled={isPending}
    >
      {isPending ? "削除中…" : "削除"}
    </Button>
  );
}
