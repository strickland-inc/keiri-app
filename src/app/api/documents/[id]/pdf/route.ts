import type { NextRequest } from "next/server";
import { getRepositories } from "@/repositories";
import { currentSession } from "@/lib/session";
import { exportDocumentPdf } from "@/lib/documents/service";
import {
  asciiFallbackFilename,
  buildDocumentPdfFilename,
} from "@/lib/documents/pdfFilename";

/** 帳票のタブ（Google スプレッドシート）を PDF に書き出して返す。 */
export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  if (!(await currentSession())) {
    return new Response("Unauthorized", { status: 401 });
  }
  const { id } = await params;
  const repos = await getRepositories();

  const doc = await repos.documents.get(id);
  const party = doc ? await repos.parties.get(doc.partyId) : null;
  if (!doc || !party) return new Response("Not Found", { status: 404 });
  if (repos.backend !== "sheets") {
    return new Response("デモでは PDF を作れません", { status: 404 });
  }

  const pdf = await exportDocumentPdf(repos, doc);
  const filename = buildDocumentPdfFilename({ doc, party });

  return new Response(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${asciiFallbackFilename(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
}
