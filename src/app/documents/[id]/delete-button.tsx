"use client";

import { useTransition } from "react";
import { removeDocument } from "@/app/documents/actions";
import { Button } from "@/components/ui/button";

export function DeleteDocumentButton({ id }: { id: string }) {
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    if (!confirm("この書類を削除しますか？")) return;
    startTransition(() => removeDocument(id));
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
