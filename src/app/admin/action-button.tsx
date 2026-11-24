"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { ActionResult } from "./actions";

/**
 * 確認つきの操作ボタン。操作そのものは呼び出し側が渡す Server Action。
 * 結果（エラー、発行したリンク）は onResult で呼び出し側へ返す。
 */
export function ActionButton({
  label,
  pendingLabel,
  confirmMessage,
  confirmLink,
  variant = "secondary",
  run,
  onResult,
  disabled,
}: {
  label: string;
  pendingLabel: string;
  /** 指定すると、押したあとに確認ダイアログを出す。 */
  confirmMessage?: string;
  /** 確認ダイアログの中に置くリンク。 */
  confirmLink?: { href: string; label: string };
  variant?: "secondary" | "danger" | "ghost";
  run: () => Promise<ActionResult>;
  onResult: (result: ActionResult) => void;
  disabled?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [asking, setAsking] = useState(false);

  function handleClick() {
    if (confirmMessage) setAsking(true);
    else execute();
  }

  function execute() {
    setAsking(false);
    startTransition(async () => {
      try {
        onResult(await run());
      } catch (error) {
        onResult({
          ok: false,
          error: error instanceof Error ? error.message : "操作に失敗しました",
        });
      }
    });
  }

  return (
    <>
      <Button
        type="button"
        variant={variant}
        size="sm"
        onClick={handleClick}
        disabled={disabled || pending}
      >
        {pending ? pendingLabel : label}
      </Button>
      {confirmMessage && (
        <ConfirmDialog
          open={asking}
          message={confirmMessage}
          confirmLabel={label}
          danger={variant === "danger"}
          link={confirmLink}
          onConfirm={execute}
          onCancel={() => setAsking(false)}
        />
      )}
    </>
  );
}
