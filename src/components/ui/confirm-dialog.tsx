"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Button } from "./button";
import { Icon } from "./icon";

/** 取り返しのつかない操作の確認。文は 1 文だけ。補助のリンクは 1 つまで。 */
export function ConfirmDialog({
  open,
  message,
  confirmLabel,
  danger,
  link,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  message: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  /** 確認の途中で開く先（新しいタブで開く）。 */
  link?: { href: string; label: string };
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      className="m-auto w-[min(26rem,calc(100vw-2rem))] rounded-2xl border border-line bg-surface p-5 text-ink backdrop:bg-ink/30"
    >
      <p className="text-sm font-medium">{message}</p>
      {link && (
        <a
          href={link.href}
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-flex items-center gap-1 text-xs text-ink-muted underline underline-offset-2 hover:text-ink"
        >
          {link.label}
          <Icon name="open_in_new" className="text-[14px]" />
        </a>
      )}
      <div className="mt-5 flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          やめる
        </Button>
        <Button
          type="button"
          variant={danger ? "danger" : "primary"}
          size="sm"
          onClick={onConfirm}
        >
          {confirmLabel}
        </Button>
      </div>
    </dialog>
  );
}
