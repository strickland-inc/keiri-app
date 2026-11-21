/**
 * 帳票のタブを、スプレッドシート側の窓口に作らせる。
 * 書類の行の保存と同じ通信で行い、タブの gid と URL を行に入れる。
 */
import { Buffer } from "node:buffer";
import type { DocumentRecord } from "@/domain/documents";
import type { Issuer } from "@/domain/issuer";
import type { Party } from "@/domain/party";
import type { RenderedSheet } from "@/lib/gateway";
import { sendToSheet } from "@/repositories/sheets/sheetsApi";
import {
  DOCUMENTS_HEADERS,
  SHEET_NAMES,
  documentToRow,
} from "@/repositories/sheets/schema";
import { planDocumentSheet } from "./sheet";

type DocumentColumn = (typeof DOCUMENTS_HEADERS)[number];

function column(name: DocumentColumn): number {
  return DOCUMENTS_HEADERS.indexOf(name);
}

/** PDF に書き出すときの指定。A4 縦、1 ページに収め、枠線や見出しを出さない。 */
const PDF_PARAMS = {
  size: "7",
  portrait: "true",
  scale: "4",
  sheetnames: "false",
  printtitle: "false",
  pagenumbers: "false",
  gridlines: "false",
  fzr: "false",
} as const;

/**
 * 帳票のタブを作り、書類の行を保存する（行が無ければ足し、あれば上書きする）。
 * 作り直すときは、新しいタブを作って行を保存してから、前のタブを消す。
 */
export async function saveDocumentWithSheet(params: {
  doc: DocumentRecord;
  party: Party;
  issuer: Issuer;
}): Promise<DocumentRecord> {
  const { doc } = params;
  const plan = planDocumentSheet(params);
  const [sheet] = await sendToSheet<[RenderedSheet]>([
    {
      op: "renderSheet",
      template: plan.template,
      name: plan.name,
      replaceGid: doc.generatedSheetId,
      replaceName: doc.generatedSheetName,
      steps: plan.steps,
      save: {
        tab: SHEET_NAMES.documents,
        id: doc.id,
        row: documentToRow(doc),
        fill: {
          [column("templateSpreadsheetId")]: "spreadsheetId",
          [column("generatedSpreadsheetId")]: "spreadsheetId",
          [column("generatedSheetId")]: "gid",
          [column("generatedSheetName")]: "name",
          [column("sheetUrl")]: "url",
        },
      },
    },
  ]);
  return {
    ...doc,
    templateSpreadsheetId: sheet.spreadsheetId,
    generatedSpreadsheetId: sheet.spreadsheetId,
    generatedSheetId: sheet.gid,
    generatedSheetName: sheet.name,
    sheetUrl: sheet.url,
  };
}

/** 書類の行と、その帳票のタブを一緒に消す。 */
export async function deleteDocumentWithSheet(
  doc: DocumentRecord,
): Promise<void> {
  await sendToSheet([
    ...(doc.generatedSheetId
      ? [
          {
            op: "deleteSheet" as const,
            gid: doc.generatedSheetId,
            name: doc.generatedSheetName,
          },
        ]
      : []),
    { op: "deleteById", tab: SHEET_NAMES.documents, id: doc.id },
  ]);
}

export async function exportSheetPdf(gid: string): Promise<Uint8Array> {
  const [{ base64 }] = await sendToSheet<[{ base64: string }]>([
    { op: "exportPdf", gid, params: { ...PDF_PARAMS } },
  ]);
  // Buffer の復号は、1 文字ずつの変換より 100 倍ほど速い。Workers の CPU の上限に収めるため。
  return Buffer.from(base64, "base64");
}
