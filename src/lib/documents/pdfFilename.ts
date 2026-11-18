import { DOCUMENT_TYPE_LABELS, type DocumentRecord } from "@/domain/documents";
import type { Party } from "@/domain/party";

function sanitizeFilenameSegment(value: string, fallback: string): string {
  const cleaned = value
    .replace(/[\\/:*?"<>|\r\n\t]/g, "・")
    .replace(/\s+/g, " ")
    .replace(/_+/g, "_")
    .trim()
    .replace(/^[. ]+|[. ]+$/g, "");

  return (cleaned || fallback).slice(0, 80);
}

export function buildDocumentPdfFilename(params: {
  doc: Pick<DocumentRecord, "type" | "title" | "issueDate" | "number">;
  party: Pick<Party, "name">;
}): string {
  const typeLabel = sanitizeFilenameSegment(
    DOCUMENT_TYPE_LABELS[params.doc.type],
    "帳票",
  );
  const title = sanitizeFilenameSegment(params.doc.title, "無題");
  const partyName = sanitizeFilenameSegment(params.party.name, "宛先未設定");
  const issueDate = params.doc.issueDate.replace(/-/g, "") || "日付未設定";
  const number = sanitizeFilenameSegment(params.doc.number, "番号未設定");
  return `${typeLabel}_${title}_${partyName}_${issueDate}_${number}.pdf`;
}

export function asciiFallbackFilename(filename: string): string {
  return filename
    .replace(/[^\x20-\x7E]/g, "_")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 180);
}
