"use client";

import { useTransition } from "react";
import { removeRevenue } from "./actions";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

export function DeleteRevenueButton({ id }: { id: string }) {
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    if (!confirm("この売上を削除しますか？この操作は取り消せません。")) return;
    startTransition(() => removeRevenue(id));
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={handleClick}
      disabled={isPending}
      aria-label="削除"
    >
      {isPending ? "…" : <Icon name="delete" className="text-[18px]" />}
    </Button>
  );
}
