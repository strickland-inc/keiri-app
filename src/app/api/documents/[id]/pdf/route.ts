import type { NextRequest } from "next/server";
import { getRepositories } from "@/repositories";
import { exportGeneratedSheetPdf } from "@/lib/sheets/documentTemplate";
import {
  asciiFallbackFilename,
  buildDocumentPdfFilename,
} from "@/lib/documents/pdfFilename";

/**
 * 帳票シート（Google スプレッドシート）を PDF に書き出して返す。
 * シートが無い書類の PDF は、サーバーの CPU を使わないようブラウザ側で作る（pdf-download-button）。
 */
export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const { documents, parties } = await getRepositories();

  const doc = await documents.get(id);
  if (!doc) {
    return new Response("Not Found", { status: 404 });
  }

  const party = await parties.get(doc.partyId);
  if (!party) {
    return new Response("Not Found", { status: 404 });
  }
  if (!doc.generatedSpreadsheetId || !doc.generatedSheetId) {
    return new Response(
      "この書類には帳票シートがありません（PDF は画面のボタンから作成します）",
      {
        status: 404,
      },
    );
  }

  const buffer = await exportGeneratedSheetPdf({
    spreadsheetId: doc.generatedSpreadsheetId,
    sheetId: doc.generatedSheetId,
  });

  const filename = buildDocumentPdfFilename({ doc, party });
  const encodedName = encodeURIComponent(filename);
  const fallbackName = asciiFallbackFilename(filename);

  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${fallbackName}"; filename*=UTF-8''${encodedName}`,
    },
  });
}
