"use client";

import { useTransition } from "react";
import { updateDocumentStatus } from "@/app/documents/actions";
import { Button } from "@/components/ui/button";
import type { DocumentStatus } from "@/domain/documents";

interface StatusActionsProps {
  id: string;
  currentStatus: DocumentStatus;
}

const TRANSITIONS: Partial<
  Record<DocumentStatus, { status: DocumentStatus; label: string }[]>
> = {
  draft: [{ status: "issued", label: "発行する" }],
  issued: [
    { status: "sent", label: "送付済みにする" },
    { status: "void", label: "無効にする" },
  ],
  sent: [
    { status: "paid", label: "入金済みにする" },
    { status: "void", label: "無効にする" },
  ],
  paid: [],
  void: [],
};

export function StatusActions({ id, currentStatus }: StatusActionsProps) {
  const [isPending, startTransition] = useTransition();
  const transitions = TRANSITIONS[currentStatus] ?? [];

  if (transitions.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {transitions.map(({ status, label }) => (
        <Button
          key={status}
          variant="secondary"
          size="sm"
          disabled={isPending}
          onClick={() =>
            startTransition(() => updateDocumentStatus(id, status))
          }
        >
          {label}
        </Button>
      ))}
    </div>
  );
}
