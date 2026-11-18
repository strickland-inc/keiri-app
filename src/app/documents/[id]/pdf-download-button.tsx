"use client";

import { useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import type { DocumentRecord } from "@/domain/documents";
import type { Issuer } from "@/domain/issuer";
import type { Party } from "@/domain/party";
import { renderDocumentPdfBlob, saveBlob } from "@/lib/pdf/browser";

interface Props {
  doc: DocumentRecord;
  issuer: Issuer | null;
  party: Party | null;
  filename: string;
  /** 帳票シートがあるときはサーバー経由で Google が書き出した PDF を使う。 */
  useSheetExport: boolean;
}

export function PdfDownloadButton({
  doc,
  issuer,
  party,
  filename,
  useSheetExport,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (useSheetExport) {
    return (
      <a
        href={`/api/documents/${doc.id}/pdf`}
        className={buttonVariants({ variant: "secondary", size: "sm" })}
      >
        <Icon name="download" className="text-[16px]" />
        PDF
      </a>
    );
  }

  async function download() {
    if (!issuer || !party) {
      setError("発行元または取引先が見つかりません");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      saveBlob(await renderDocumentPdfBlob({ doc, issuer, party }), filename);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "PDF を作成できませんでした");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={download}
        disabled={busy}
      >
        <Icon
          name={busy ? "hourglass_top" : "download"}
          className="text-[16px]"
        />
        {busy ? "作成中…" : "PDF"}
      </Button>
      {error && (
        <span role="alert" className="text-xs text-danger">
          {error}
        </span>
      )}
    </>
  );
}
