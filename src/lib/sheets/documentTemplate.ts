import {
  DRIVE_SCOPE,
  SHEETS_SCOPE,
  createSheetsApi,
  exportSheetAsPdf,
  getDriveFile,
} from "@/lib/google/rest";
import { getDocumentTemplateConfig, requireSheetsConfig } from "@/lib/config";
import { DOCUMENT_TYPE_LABELS, type DocumentRecord } from "@/domain/documents";
import type { Issuer } from "@/domain/issuer";
import type { Party } from "@/domain/party";
import { lineAmount, summarize } from "@/domain/money";
import { formatJpDate } from "@/lib/utils";

/** テンプレート操作に使う Sheets クライアント（Drive も読むため両方の権限）。 */
function getSheetsApi() {
  return createSheetsApi([SHEETS_SCOPE, DRIVE_SCOPE]);
}

export async function exportGeneratedSheetPdf(params: {
  spreadsheetId: string;
  sheetId: string;
}): Promise<Uint8Array> {
  const url = new URL(
    `https://docs.google.com/spreadsheets/d/${params.spreadsheetId}/export`,
  );
  url.searchParams.set("format", "pdf");
  url.searchParams.set("gid", params.sheetId);
  url.searchParams.set("size", "7");
  url.searchParams.set("portrait", "true");
  url.searchParams.set("scale", "4");
  url.searchParams.set("sheetnames", "false");
  url.searchParams.set("printtitle", "false");
  url.searchParams.set("pagenumbers", "false");
  url.searchParams.set("gridlines", "false");
  url.searchParams.set("fzr", "false");

  return exportSheetAsPdf(url);
}

/**
 * テンプレートにサービスアカウントが届くかを確かめ、見えた内容を返す。
 * 出力先フォルダ（DOCUMENT_OUTPUT_FOLDER_ID）は、設定されているときだけ確かめる。
 */
export async function checkDocumentTemplateAccess(): Promise<{
  spreadsheetId: string;
  title: string;
  outputFolder: { id: string; name: string; url: string } | null;
  sheets: Array<{ title: string; sheetId: number }>;
}> {
  const sheets = getSheetsApi();
  const { spreadsheetId, outputFolderId } = getDocumentTemplateConfig();
  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    includeGridData: false,
  });

  let outputFolder: { id: string; name: string; url: string } | null = null;
  if (outputFolderId) {
    const folder = await getDriveFile(outputFolderId);
    outputFolder = {
      id: outputFolderId,
      name: folder.data.name ?? "",
      url:
        folder.data.webViewLink ??
        `https://drive.google.com/drive/folders/${outputFolderId}`,
    };
  }

  return {
    spreadsheetId,
    title: meta.data.properties?.title ?? "",
    outputFolder,
    sheets: (meta.data.sheets ?? []).flatMap((sheet) => {
      const title = sheet.properties?.title;
      const sheetId = sheet.properties?.sheetId;
      return title && sheetId != null ? [{ title, sheetId }] : [];
    }),
  };
}

function quoteSheetName(name: string): string {
  return `'${name.replaceAll("'", "''")}'`;
}

function sheetUrl(spreadsheetId: string, sheetId: number): string {
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit#gid=${sheetId}`;
}

function safeSheetName(value: string): string {
  return value.replace(/[\[\]\*\/\\?:]/g, "").slice(0, 90);
}

function documentTitle(type: DocumentRecord["type"]): string {
  if (type === "invoice") return "請     求     書";
  if (type === "quote") return "御     見     積     書";
  return DOCUMENT_TYPE_LABELS[type];
}

function templateSheetTitle(type: DocumentRecord["type"]): string {
  if (type === "invoice") return "請求書";
  if (type === "quote") return "見積書";
  if (type === "delivery_note") return "納品書";
  if (type === "purchase_order") return "発注書";
  if (type === "receipt") return "領収書";
  return "請求書";
}

function postalCodeLine(postalCode?: string): string {
  return postalCode ? `〒${postalCode}` : "";
}

function formatYenText(value: number): string {
  return `¥${Math.trunc(value).toLocaleString("ja-JP")}`;
}

function partyHonorificLine(party: Party): string {
  if (party.contactName)
    return `${party.contactName}　${party.honorific ?? "様"}`;
  return party.honorific ?? "御中";
}

function buildInvoiceValues(params: {
  doc: DocumentRecord;
  party: Party;
  issuer: Issuer;
}): Array<Array<string | number>> {
  const { doc, party, issuer } = params;
  const summary = summarize(doc.items);
  const rows: Array<Array<string | number>> = Array.from({ length: 40 }, () =>
    Array.from({ length: 8 }, () => ""),
  );

  rows[0][0] = documentTitle(doc.type);
  rows[3][0] = postalCodeLine(party.postalCode);
  rows[4][0] = party.address ?? "";
  rows[5][0] = "";
  rows[6][0] = party.name;
  rows[7][0] = partyHonorificLine(party);
  rows[10][0] =
    doc.type === "quote"
      ? "下記の通りお見積申し上げます。"
      : "下記の通りご請求申し上げます。";
  rows[12][0] = doc.type === "quote" ? "お見積金額" : "ご請求金額";
  rows[12][1] = summary.total;

  rows[3][6] = "発行日：";
  rows[3][7] = formatJpDate(doc.issueDate);
  rows[4][6] = "伝票番号：";
  rows[4][7] = `'${doc.number}`;
  rows[6][5] = issuer.name;
  // 記載名義は会社名の直下に置き、住所以下を1行下げる。行 11 は枠のない空き行で、行 12 の振込先には届かない。
  const shift = issuer.signatoryName ? 1 : 0;
  if (issuer.signatoryName) rows[7][5] = issuer.signatoryName;
  rows[7 + shift][5] = postalCodeLine(issuer.postalCode);
  rows[8 + shift][5] = [issuer.address, issuer.building]
    .filter(Boolean)
    .join(" ");
  rows[9 + shift][5] = issuer.phone ? "電  話：" : "";
  rows[9 + shift][6] = issuer.phone ?? "";
  rows[10 + shift][5] = issuer.email ? "E-mail：" : "";
  rows[10 + shift][6] = issuer.email ?? "";
  // 振込先は請求書だけに載せる（scripts/keiri.mjs と同じ）
  rows[12][5] = doc.type === "invoice" ? "振込先" : "";
  rows[12][6] = doc.type === "invoice" ? (issuer.bankInfo ?? "") : "";
  rows[13][5] = doc.dueDate ? "支払期日" : "";
  rows[13][6] = doc.dueDate ? formatJpDate(doc.dueDate) : "";

  rows[15][0] = "商品名";
  rows[15][5] = "数量";
  rows[15][6] = "単価";
  rows[15][7] = "金額";

  doc.items.slice(0, 14).forEach((item, index) => {
    const row = rows[16 + index];
    row[0] = item.name;
    row[5] = `${item.quantity}${item.unit ?? ""}`;
    row[6] = formatYenText(item.unitPrice);
    row[7] = formatYenText(lineAmount(item));
  });

  rows[31][5] = "小計";
  rows[31][6] = summary.subtotal;
  rows[32][5] = "消費税";
  rows[32][6] = summary.taxTotal;
  rows[33][5] = "合計金額";
  rows[33][6] = summary.total;
  rows[35][0] = "備考";
  rows[36][0] = doc.notes;

  return rows;
}

// 備考欄（36〜40行目）にかかる結合を、テンプレートにある範囲どおりに解除する。
// 見積書のテンプレートは備考欄の3行がひとかたまりに結合されており、
// 範囲の一部だけを解除しようとすると API が拒否する（2026-10-15）。
// **値を書き込む前に解除する。** 結合の中の左上以外のセルに書いた値（37行目の備考）は、
// 書いたあとで解除しても残らない（2026-10-15 に備考が消えた）。
// 同じ処理が scripts/keiri.mjs にもある。
async function unmergeNotesArea(params: {
  sheets: ReturnType<typeof getSheetsApi>;
  spreadsheetId: string;
  sheetId: number;
}): Promise<void> {
  const requests = await notesUnmergeRequests(params);
  if (!requests.length) return;
  await params.sheets.spreadsheets.batchUpdate({
    spreadsheetId: params.spreadsheetId,
    requestBody: { requests },
  });
}

async function notesUnmergeRequests(params: {
  sheets: ReturnType<typeof getSheetsApi>;
  spreadsheetId: string;
  sheetId: number;
}) {
  const res = await params.sheets.spreadsheets.get({
    spreadsheetId: params.spreadsheetId,
  });
  const sheet = (res.data.sheets ?? []).find(
    (s) => s.properties?.sheetId === params.sheetId,
  );
  return (sheet?.merges ?? [])
    .filter((m) => (m.startRowIndex ?? 0) < 40 && (m.endRowIndex ?? 0) > 35)
    .map((range) => ({ unmergeCells: { range } }));
}

async function applyDocumentSheetFormat(params: {
  sheets: ReturnType<typeof getSheetsApi>;
  spreadsheetId: string;
  sheetId: number;
}): Promise<void> {
  await params.sheets.spreadsheets.batchUpdate({
    spreadsheetId: params.spreadsheetId,
    requestBody: {
      requests: [
        {
          mergeCells: {
            range: {
              sheetId: params.sheetId,
              startRowIndex: 36,
              endRowIndex: 37,
              startColumnIndex: 0,
              endColumnIndex: 8,
            },
            mergeType: "MERGE_ALL",
          },
        },
        {
          updateDimensionProperties: {
            range: {
              sheetId: params.sheetId,
              dimension: "ROWS",
              startIndex: 35,
              endIndex: 37,
            },
            properties: {
              hiddenByUser: false,
            },
            fields: "hiddenByUser",
          },
        },
        {
          updateDimensionProperties: {
            range: {
              sheetId: params.sheetId,
              dimension: "ROWS",
              startIndex: 37,
              endIndex: 40,
            },
            properties: {
              hiddenByUser: true,
            },
            fields: "hiddenByUser",
          },
        },
        {
          updateDimensionProperties: {
            range: {
              sheetId: params.sheetId,
              dimension: "ROWS",
              startIndex: 36,
              endIndex: 37,
            },
            properties: {
              pixelSize: 96,
            },
            fields: "pixelSize",
          },
        },
        {
          repeatCell: {
            range: {
              sheetId: params.sheetId,
              startRowIndex: 36,
              endRowIndex: 37,
              startColumnIndex: 0,
              endColumnIndex: 8,
            },
            cell: {
              userEnteredFormat: {
                wrapStrategy: "WRAP",
                verticalAlignment: "MIDDLE",
              },
            },
            fields: "userEnteredFormat(wrapStrategy,verticalAlignment)",
          },
        },
        {
          updateBorders: {
            range: {
              sheetId: params.sheetId,
              startRowIndex: 36,
              endRowIndex: 37,
              startColumnIndex: 0,
              endColumnIndex: 8,
            },
            bottom: {
              style: "SOLID",
              width: 1,
              color: { red: 0, green: 0, blue: 0 },
            },
          },
        },
        {
          repeatCell: {
            range: {
              sheetId: params.sheetId,
              startRowIndex: 4,
              endRowIndex: 5,
              startColumnIndex: 7,
              endColumnIndex: 8,
            },
            cell: {
              userEnteredFormat: {
                horizontalAlignment: "RIGHT",
              },
            },
            fields: "userEnteredFormat.horizontalAlignment",
          },
        },
        {
          repeatCell: {
            range: {
              sheetId: params.sheetId,
              startRowIndex: 12,
              endRowIndex: 13,
              startColumnIndex: 5,
              endColumnIndex: 6,
            },
            cell: {
              userEnteredFormat: {
                horizontalAlignment: "CENTER",
              },
            },
            fields: "userEnteredFormat.horizontalAlignment",
          },
        },
        {
          repeatCell: {
            range: {
              sheetId: params.sheetId,
              startRowIndex: 12,
              endRowIndex: 13,
              startColumnIndex: 6,
              endColumnIndex: 8,
            },
            cell: {
              userEnteredFormat: {
                horizontalAlignment: "LEFT",
              },
            },
            fields: "userEnteredFormat.horizontalAlignment",
          },
        },
      ],
    },
  });
}

export async function createDocumentSpreadsheet(params: {
  doc: DocumentRecord;
  party: Party;
  issuer: Issuer;
}): Promise<
  Pick<
    DocumentRecord,
    | "templateSpreadsheetId"
    | "generatedSpreadsheetId"
    | "generatedSheetId"
    | "generatedSheetName"
    | "sheetUrl"
  >
> {
  const sheets = getSheetsApi();
  const { spreadsheetId: backendSpreadsheetId } = requireSheetsConfig();
  const { spreadsheetId, sheetId } = getDocumentTemplateConfig();

  const source = await sheets.spreadsheets.get({
    spreadsheetId,
    includeGridData: false,
  });
  const expectedSheetTitle = templateSheetTitle(params.doc.type);
  const sourceSheet =
    source.data.sheets?.find(
      (sheet) => sheet.properties?.sheetId === sheetId,
    ) ??
    source.data.sheets?.find(
      (sheet) => sheet.properties?.title === expectedSheetTitle,
    ) ??
    source.data.sheets?.[0];
  const sourceSheetId = sourceSheet?.properties?.sheetId;
  const sourceSheetName = sourceSheet?.properties?.title;
  if (sourceSheetId == null || !sourceSheetName) {
    throw new Error("帳票テンプレートのシートが見つかりません");
  }

  const generatedSheetName = safeSheetName(
    `${DOCUMENT_TYPE_LABELS[params.doc.type]}_${params.doc.number}_${params.party.name}`,
  );

  const copiedSheet = await sheets.spreadsheets.sheets.copyTo({
    spreadsheetId,
    sheetId: sourceSheetId,
    requestBody: { destinationSpreadsheetId: backendSpreadsheetId },
  });
  const generatedSheetId = copiedSheet.data.sheetId;
  if (generatedSheetId == null) {
    throw new Error("コピー後の帳票シートが見つかりません");
  }

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: backendSpreadsheetId,
    requestBody: {
      requests: [
        {
          updateSheetProperties: {
            properties: {
              sheetId: generatedSheetId,
              title: generatedSheetName,
            },
            fields: "title",
          },
        },
      ],
    },
  });

  await unmergeNotesArea({
    sheets,
    spreadsheetId: backendSpreadsheetId,
    sheetId: generatedSheetId,
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId: backendSpreadsheetId,
    range: `${quoteSheetName(generatedSheetName)}!A1:H40`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: buildInvoiceValues(params) },
  });
  await applyDocumentSheetFormat({
    sheets,
    spreadsheetId: backendSpreadsheetId,
    sheetId: generatedSheetId,
  });

  return {
    templateSpreadsheetId: spreadsheetId,
    generatedSpreadsheetId: backendSpreadsheetId,
    generatedSheetId: String(generatedSheetId),
    generatedSheetName,
    sheetUrl: sheetUrl(backendSpreadsheetId, generatedSheetId),
  };
}
