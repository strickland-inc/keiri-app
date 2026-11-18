#!/usr/bin/env node
/**
 * 経理アプリの CLI。エージェントから帳票と取引先を操作する。
 * 出力は常に JSON。--execute を付けない限り dry-run で、シートには何も書かない。
 *
 *   keiri template check
 *   keiri clients list | get --name NAME | create --name NAME [--execute]
 *   keiri invoices|estimates|documents create --input FILE.json [--create-client] [--execute]
 *
 * 接続先は .env.local（または環境変数）の GOOGLE_* と SHEETS_SPREADSHEET_ID。
 * 帳票の雛形は DOCUMENT_TEMPLATE_SPREADSHEET_ID（任意。未設定ならシートは作らない）。
 */
import { google } from "googleapis";
import fs from "node:fs";
import path from "node:path";
import { readEnvLocal } from "./env-local.mjs";

const env = { ...process.env, ...readEnvLocal() };

function json(data, code = 0) {
  process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
  process.exit(code);
}

function fail(message, details = undefined, code = 1) {
  json({ ok: false, error: message, ...(details ? { details } : {}) }, code);
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      args._.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

function requireSheetsEnv() {
  const required = [
    "GOOGLE_SERVICE_ACCOUNT_EMAIL",
    "GOOGLE_PRIVATE_KEY",
    "SHEETS_SPREADSHEET_ID",
  ];
  const missing = required.filter((key) => !env[key]);
  if (missing.length) fail("Google Sheets config is missing", { missing });
  return {
    email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    spreadsheetId: env.SHEETS_SPREADSHEET_ID,
  };
}

function auth() {
  const { email, key } = requireSheetsEnv();
  return new google.auth.JWT({
    email,
    key,
    scopes: [
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/drive",
    ],
  });
}

const jwt = auth();
const sheets = google.sheets({ version: "v4", auth: jwt });
const drive = google.drive({ version: "v3", auth: jwt });
const backendSpreadsheetId = requireSheetsEnv().spreadsheetId;

const DOCUMENT_TYPES = new Set([
  "invoice",
  "quote",
  "delivery_note",
  "purchase_order",
  "receipt",
]);

const DOCUMENT_TYPE_LABELS = {
  invoice: "請求書",
  quote: "見積書",
  delivery_note: "納品書",
  purchase_order: "発注書",
  receipt: "領収書",
};

function now() {
  return new Date().toISOString();
}

function uuid() {
  return globalThis.crypto.randomUUID();
}

function sheetUrl(spreadsheetId, sheetId) {
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit#gid=${sheetId}`;
}

function quoteSheetName(name) {
  return `'${String(name).replaceAll("'", "''")}'`;
}

async function readRows(sheetName, width = 26) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: backendSpreadsheetId,
    range: `${sheetName}!A:Z`,
  });
  return (res.data.values ?? []).slice(1).map((row) => {
    const padded = [...row];
    while (padded.length < width) padded.push("");
    return padded;
  });
}

async function appendRow(sheetName, row) {
  await sheets.spreadsheets.values.append({
    spreadsheetId: backendSpreadsheetId,
    range: `${sheetName}!A:A`,
    valueInputOption: "RAW",
    requestBody: { values: [row] },
  });
}

// 採番カウンターのキー。Web 側（src/repositories/scope.ts）と同じ規則で作る。
// ここがずれると CLI と画面で同じ番号を二重に振ってしまう。
function counterKey(issuerId, type) {
  return `${issuerId}:${type}`;
}

async function updateCounter(key, next) {
  const rows = await readRows("counters", 2);
  const idx = rows.findIndex((row) => row[0] === key);
  if (idx < 0) {
    await appendRow("counters", [key, String(next)]);
    return;
  }
  await sheets.spreadsheets.values.update({
    spreadsheetId: backendSpreadsheetId,
    range: `counters!A${idx + 2}:B${idx + 2}`,
    valueInputOption: "RAW",
    requestBody: { values: [[key, String(next)]] },
  });
}

/** その会社・その帳票種別で既に使われている最大の連番。カウンターの種にする。 */
async function maxIssuedSeq(issuerId, type) {
  const rows = await readRows("documents", 22);
  let max = 0;
  for (const row of rows) {
    if (row[4] !== issuerId || row[1] !== type) continue;
    const m = String(row[2] ?? "").match(/(\d+)\s*$/);
    if (m) max = Math.max(max, Number.parseInt(m[1], 10));
  }
  return max;
}

async function peekNextNumber(issuerId, type) {
  const rows = await readRows("counters", 2);
  const current = rows.find((row) => row[0] === counterKey(issuerId, type));
  const stored = Number.parseInt(current?.[1] || "0", 10);
  return Math.max(stored, await maxIssuedSeq(issuerId, type)) + 1;
}

function partyFromRow(row) {
  return {
    id: row[0],
    name: row[1],
    contactName: row[2] || undefined,
    honorific: row[3] || undefined,
    postalCode: row[4] || undefined,
    address: row[5] || undefined,
    email: row[6] || undefined,
    phone: row[7] || undefined,
    registrationNumber: row[8] || undefined,
    defaultTitle: row[9] || undefined,
    createdAt: row[10],
    updatedAt: row[11],
  };
}

async function listClients() {
  return (await readRows("parties", 12)).map(partyFromRow);
}

async function findClientByName(name) {
  const clients = await listClients();
  return clients.find((client) => client.name === name) ?? null;
}

async function createClient(input, execute) {
  const existing = await findClientByName(input.name);
  if (existing) return { status: "existing", client: existing };

  const ts = now();
  const client = {
    id: uuid(),
    name: input.name,
    contactName: input.contactName || "",
    honorific: input.honorific || "御中",
    postalCode: input.postalCode || "",
    address: input.address || "",
    email: input.email || "",
    phone: input.phone || "",
    registrationNumber: input.registrationNumber || "",
    defaultTitle: input.defaultTitle || "",
    createdAt: ts,
    updatedAt: ts,
  };

  if (execute) {
    await appendRow("parties", [
      client.id,
      client.name,
      client.contactName,
      client.honorific,
      client.postalCode,
      client.address,
      client.email,
      client.phone,
      client.registrationNumber,
      client.defaultTitle,
      client.createdAt,
      client.updatedAt,
    ]);
  }

  return { status: execute ? "created" : "dry-run", client };
}

function issuerFromRow(row) {
  return {
    id: row[0],
    name: row[1],
    postalCode: row[2] || undefined,
    address: row[3] || undefined,
    building: row[4] || undefined,
    phone: row[5] || undefined,
    email: row[6] || undefined,
    registrationNumber: row[7] || undefined,
    bankInfo: row[8] || undefined,
    sealImageUrl: row[9] || undefined,
    isDefault: row[10] === "TRUE",
    createdAt: row[11],
    updatedAt: row[12],
    signatoryName: row[15] || undefined,
  };
}

async function defaultIssuer() {
  const rows = await readRows("issuers", 16);
  const row = rows.find((r) => r[10] === "TRUE") ?? rows[0];
  if (!row) fail("Default issuer is missing");
  return issuerFromRow(row);
}

/**
 * 帳票を出す会社を決める。名前を渡さなければ既定会社。
 * 部分一致も見るので "サンプル" だけでも当たる。
 */
async function resolveIssuer(name) {
  if (!name) return defaultIssuer();
  const rows = await readRows("issuers", 13);
  const wanted = String(name).trim();
  const hit =
    rows.find((r) => r[1] === wanted) ??
    rows.find((r) => String(r[1] ?? "").includes(wanted));
  if (!hit) fail("Company not found", { company: wanted });
  return issuerFromRow(hit);
}

function normalizeDocumentInput(input) {
  const type = input.type || "invoice";
  if (!DOCUMENT_TYPES.has(type)) fail("Unsupported document type", { type });
  const items = Array.isArray(input.items) ? input.items : [];
  if (!items.length) fail("Document must have at least one line item");
  return {
    type,
    // 会社（発行元）。未指定なら既定会社。
    company: input.company || input.issuer || input.issuerName || undefined,
    partyName: input.partyName || input.client || input.clientName,
    title: input.title || "",
    issueDate: input.issueDate || new Date().toISOString().slice(0, 10),
    items: items.map((item) => ({
      name: String(item.name || ""),
      quantity: Number(item.quantity ?? 1),
      unit: item.unit ? String(item.unit) : undefined,
      unitPrice: Number(item.unitPrice ?? 0),
      taxRate: Number(item.taxRate ?? 0.1),
    })),
    notes: input.notes || "",
    status: input.status || "draft",
    dueDate: input.dueDate || undefined,
    validUntil: input.validUntil || undefined,
    paymentTerms: input.paymentTerms || undefined,
    purpose: input.purpose || undefined,
  };
}

function summarize(items) {
  const byRate = new Map();
  for (const item of items) {
    const amount = Math.trunc(item.quantity * item.unitPrice);
    byRate.set(item.taxRate, (byRate.get(item.taxRate) ?? 0) + amount);
  }
  let subtotal = 0;
  let taxTotal = 0;
  for (const [rate, taxableAmount] of byRate.entries()) {
    subtotal += taxableAmount;
    taxTotal += Math.floor(taxableAmount * rate);
  }
  return { subtotal, taxTotal, total: subtotal + taxTotal };
}

function formatJpDate(date) {
  const [year, month, day] = String(date).split("-");
  if (!year || !month || !day) return String(date);
  return `${Number(year)}年${Number(month)}月${Number(day)}日`;
}

function postalCodeLine(postalCode) {
  return postalCode ? `〒${postalCode}` : "";
}

function formatYenText(value) {
  return `¥${Math.trunc(value).toLocaleString("ja-JP")}`;
}

function partyHonorificLine(client) {
  if (client.contactName)
    return `${client.contactName}　${client.honorific || "様"}`;
  return client.honorific || "御中";
}

function documentTitle(type) {
  if (type === "invoice") return "請     求     書";
  if (type === "quote") return "御     見     積     書";
  return DOCUMENT_TYPE_LABELS[type] ?? type;
}

function templateSheetTitle(type) {
  return DOCUMENT_TYPE_LABELS[type] ?? "請求書";
}

/** 帳票シートの A1:H40 に書く値。行・列の位置は雛形シートのレイアウトに固定。 */
function fixedTemplateValues({ doc, client, issuer, number }) {
  const summary = summarize(doc.items);
  const rows = Array.from({ length: 40 }, () =>
    Array.from({ length: 8 }, () => ""),
  );

  rows[0][0] = documentTitle(doc.type);
  rows[3][0] = postalCodeLine(client.postalCode);
  rows[4][0] = client.address || "";
  rows[6][0] = client.name;
  rows[7][0] = partyHonorificLine(client);
  rows[10][0] =
    doc.type === "quote"
      ? "下記の通りお見積申し上げます。"
      : "下記の通りご請求申し上げます。";
  rows[12][0] = doc.type === "quote" ? "お見積金額" : "ご請求金額";
  rows[12][1] = summary.total;

  rows[3][6] = "発行日：";
  rows[3][7] = formatJpDate(doc.issueDate);
  rows[4][6] = "伝票番号：";
  // USER_ENTERED で書くため、先頭の ' で数値化を防ぎ 0001 の 0 を残す
  rows[4][7] = `'${number}`;
  rows[6][5] = issuer.name;
  // 記載名義は会社名の直下。Web 側（src/lib/sheets/documentTemplate.ts）と同じ配置にする。
  const shift = issuer.signatoryName ? 1 : 0;
  if (issuer.signatoryName) rows[7][5] = issuer.signatoryName;
  rows[7 + shift][5] = postalCodeLine(issuer.postalCode);
  rows[8 + shift][5] = [issuer.address, issuer.building]
    .filter(Boolean)
    .join(" ");
  rows[9 + shift][5] = issuer.phone ? "電  話：" : "";
  rows[9 + shift][6] = issuer.phone || "";
  rows[10 + shift][5] = issuer.email ? "E-mail：" : "";
  rows[10 + shift][6] = issuer.email || "";
  rows[12][5] = doc.type === "invoice" ? "振込先" : "";
  rows[12][6] = doc.type === "invoice" ? issuer.bankInfo || "" : "";
  rows[13][5] = doc.dueDate ? "支払期日" : "";
  rows[13][6] = doc.dueDate ? formatJpDate(doc.dueDate) : "";

  rows[15][0] = "商品名";
  rows[15][5] = "数量";
  rows[15][6] = "単価";
  rows[15][7] = "金額";

  doc.items.slice(0, 14).forEach((item, index) => {
    const row = rows[16 + index];
    row[0] = item.name;
    row[5] = `${item.quantity}${item.unit || ""}`;
    row[6] = formatYenText(item.unitPrice);
    row[7] = formatYenText(Math.trunc(item.quantity * item.unitPrice));
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
// 同じ処理が src/lib/sheets/documentTemplate.ts にもある。
async function unmergeNotesArea({ spreadsheetId, sheetId }) {
  const requests = await notesUnmergeRequests({ spreadsheetId, sheetId });
  if (!requests.length) return;
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests },
  });
}

async function notesUnmergeRequests({ spreadsheetId, sheetId }) {
  const res = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets(properties.sheetId,merges)",
  });
  const sheet = (res.data.sheets ?? []).find(
    (s) => s.properties?.sheetId === sheetId,
  );
  return (sheet?.merges ?? [])
    .filter((m) => (m.startRowIndex ?? 0) < 40 && (m.endRowIndex ?? 0) > 35)
    .map((range) => ({ unmergeCells: { range } }));
}

/** 備考行（37行目）を結合して広げ、使わない下の行を隠す。金額欄の寄せも整える。 */
async function applyDocumentSheetFormat({ spreadsheetId, sheetId }) {
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          mergeCells: {
            range: {
              sheetId,
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
              sheetId,
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
              sheetId,
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
              sheetId,
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
              sheetId,
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
              sheetId,
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
              sheetId,
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
              sheetId,
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
              sheetId,
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

async function templateMetadata() {
  const templateSpreadsheetId = env.DOCUMENT_TEMPLATE_SPREADSHEET_ID;
  const outputFolderId = env.DOCUMENT_OUTPUT_FOLDER_ID;
  let res;
  try {
    res = await sheets.spreadsheets.get({
      spreadsheetId: templateSpreadsheetId,
      includeGridData: false,
    });
  } catch (error) {
    fail(
      "Template spreadsheet access failed",
      {
        spreadsheetId: templateSpreadsheetId,
        message: error.message,
      },
      2,
    );
  }
  const templateSheetId =
    env.DOCUMENT_TEMPLATE_SHEET_ID &&
    /^\d+$/.test(env.DOCUMENT_TEMPLATE_SHEET_ID)
      ? Number(env.DOCUMENT_TEMPLATE_SHEET_ID)
      : res.data.sheets?.[0]?.properties?.sheetId;
  if (templateSheetId == null) fail("Template sheet is missing");

  // 出力先フォルダは任意。設定されているときだけ、届くかを確かめる。
  let outputFolder = null;
  if (outputFolderId) {
    let folder;
    try {
      folder = await drive.files.get({
        fileId: outputFolderId,
        fields: "id,name,mimeType,webViewLink",
        supportsAllDrives: true,
      });
    } catch (error) {
      fail(
        "Output Drive folder access failed",
        {
          folderId: outputFolderId,
          message: error.message,
        },
        2,
      );
    }
    outputFolder = {
      id: outputFolderId,
      name: folder.data.name || "",
      url:
        folder.data.webViewLink ||
        `https://drive.google.com/drive/folders/${outputFolderId}`,
    };
  }

  return {
    spreadsheetId: templateSpreadsheetId,
    title: res.data.properties?.title || "",
    sheetId: templateSheetId,
    outputFolder,
    sheets: (res.data.sheets ?? []).map((sheet) => ({
      title: sheet.properties?.title,
      sheetId: sheet.properties?.sheetId,
    })),
  };
}

/**
 * テンプレートと出力先フォルダの設定を確かめる。
 * どちらも任意なので、未設定の項目は確かめずに ok とし、message で未設定と伝える。
 * テンプレートが未設定なら、帳票はシートを作らずに台帳の行だけ足す（PDF はアプリが組む）。
 */
async function checkTemplateSetup() {
  const templateSpreadsheetId = env.DOCUMENT_TEMPLATE_SPREADSHEET_ID;
  const outputFolderId = env.DOCUMENT_OUTPUT_FOLDER_ID;
  const checks = {
    templateSpreadsheet: {
      ok: !templateSpreadsheetId,
      spreadsheetId: templateSpreadsheetId ?? "",
      title: "",
      sheets: [],
      message: templateSpreadsheetId
        ? ""
        : "未設定。帳票はシートを作らず、アプリの PDF だけで出す",
    },
    outputFolder: {
      ok: !outputFolderId,
      folderId: outputFolderId ?? "",
      name: "",
      url: outputFolderId
        ? `https://drive.google.com/drive/folders/${outputFolderId}`
        : "",
      message: outputFolderId ? "" : "未設定",
    },
  };

  if (templateSpreadsheetId) {
    await checkTemplateSpreadsheet(checks.templateSpreadsheet);
  }
  if (outputFolderId) {
    await checkOutputFolder(checks.outputFolder);
  }

  return checks;
}

async function checkTemplateSpreadsheet(check) {
  try {
    const res = await sheets.spreadsheets.get({
      spreadsheetId: check.spreadsheetId,
      includeGridData: false,
    });
    check.ok = true;
    check.title = res.data.properties?.title || "";
    check.sheets = (res.data.sheets ?? []).map((sheet) => ({
      title: sheet.properties?.title,
      sheetId: sheet.properties?.sheetId,
    }));
  } catch (error) {
    check.message = error.message;
  }
}

async function checkOutputFolder(check) {
  try {
    const folder = await drive.files.get({
      fileId: check.folderId,
      fields: "id,name,mimeType,webViewLink",
      supportsAllDrives: true,
    });
    check.ok = true;
    check.name = folder.data.name || "";
    check.url = folder.data.webViewLink || check.url;
  } catch (error) {
    check.message = error.message;
  }
}

async function createTemplateSheet({ doc, client, issuer, number }) {
  const meta = await templateMetadata();
  const safeClient = client.name.replace(/[\[\]\*\/\\?:]/g, "");
  const generatedSheetName =
    `${DOCUMENT_TYPE_LABELS[doc.type]}_${number}_${safeClient}`.slice(0, 90);
  const expectedSheetTitle = templateSheetTitle(doc.type);
  const sourceSheet =
    meta.sheets.find((sheet) => sheet.title === expectedSheetTitle) ??
    meta.sheets.find((sheet) => sheet.sheetId === meta.sheetId) ??
    meta.sheets[0];
  if (!sourceSheet?.sheetId) {
    fail(
      "Template sheet is missing",
      {
        templateSpreadsheetId: meta.spreadsheetId,
        expectedSheetTitle,
      },
      2,
    );
  }

  const copiedSheet = await sheets.spreadsheets.sheets.copyTo({
    spreadsheetId: meta.spreadsheetId,
    sheetId: sourceSheet.sheetId,
    requestBody: { destinationSpreadsheetId: backendSpreadsheetId },
  });
  const generatedSpreadsheetId = backendSpreadsheetId;
  const generatedSheetId = copiedSheet.data.sheetId;
  if (generatedSheetId == null)
    fail("Copied spreadsheet has no writable sheet");

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: generatedSpreadsheetId,
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

  const range = `${quoteSheetName(generatedSheetName)}!A1:H40`;

  await unmergeNotesArea({
    spreadsheetId: generatedSpreadsheetId,
    sheetId: generatedSheetId,
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId: generatedSpreadsheetId,
    range,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: fixedTemplateValues({ doc, client, issuer, number }),
    },
  });
  await applyDocumentSheetFormat({
    spreadsheetId: generatedSpreadsheetId,
    sheetId: generatedSheetId,
  });

  return {
    templateSpreadsheetId: meta.spreadsheetId,
    generatedSpreadsheetId,
    generatedSheetId: String(generatedSheetId),
    generatedSheetName,
    sheetUrl: sheetUrl(generatedSpreadsheetId, generatedSheetId),
    outputFolder: meta.outputFolder,
  };
}

async function createDocument(input, { execute, createClientIfMissing }) {
  const doc = normalizeDocumentInput(input);
  if (!doc.partyName) fail("partyName/client is required");

  let client = await findClientByName(doc.partyName);
  if (!client && createClientIfMissing) {
    const result = await createClient({ name: doc.partyName }, execute);
    client = result.client;
  }
  if (!client) fail("Client not found", { partyName: doc.partyName });

  const issuer = await resolveIssuer(doc.company);
  const nextSeq = await peekNextNumber(issuer.id, doc.type);
  const number = String(nextSeq).padStart(4, "0");
  const summary = summarize(doc.items);

  const dryRunResult = {
    ok: true,
    action: `${doc.type}.create`,
    mode: execute ? "execute" : "dry-run",
    requiresApproval: !execute,
    document: {
      ...doc,
      number,
      partyId: client.id,
      issuerId: issuer.id,
      summary,
    },
  };

  if (!execute) return dryRunResult;

  // テンプレートが未設定なら、シートは作らず台帳の行だけ足す（PDF はアプリが組む）。
  const template = env.DOCUMENT_TEMPLATE_SPREADSHEET_ID
    ? await createTemplateSheet({ doc, client, issuer, number })
    : null;
  await updateCounter(counterKey(issuer.id, doc.type), nextSeq);
  const ts = now();
  const id = uuid();
  const row = [
    id,
    doc.type,
    number,
    doc.issueDate,
    issuer.id,
    client.id,
    doc.title,
    JSON.stringify(doc.items),
    doc.notes,
    doc.status,
    doc.dueDate || "",
    doc.validUntil || "",
    doc.paymentTerms || "",
    doc.purpose || "",
    ts,
    ts,
    "",
    template?.templateSpreadsheetId ?? "",
    template?.generatedSpreadsheetId ?? "",
    template?.generatedSheetId ?? "",
    template?.generatedSheetName ?? "",
    template?.sheetUrl ?? "",
  ];
  await appendRow("documents", row);

  return {
    ...dryRunResult,
    requiresApproval: false,
    id,
    number,
    sheet: template,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const [resource, action] = args._;
  const execute = args.execute === true;

  if (resource === "template" && action === "check") {
    const checks = await checkTemplateSetup();
    if (!checks.templateSpreadsheet.ok || !checks.outputFolder.ok) {
      fail("Template setup check failed", { checks }, 2);
    }
    json({ ok: true, checks });
  }

  if (resource === "clients" && action === "list") {
    json({ ok: true, clients: await listClients() });
  }

  if (resource === "clients" && action === "get") {
    if (!args.name) fail("--name is required");
    json({ ok: true, client: await findClientByName(args.name) });
  }

  if (resource === "clients" && action === "create") {
    if (!args.name) fail("--name is required");
    const result = await createClient(
      {
        name: args.name,
        honorific: args.honorific,
        contactName: args.contactName,
        postalCode: args.postalCode,
        address: args.address,
        email: args.email,
        phone: args.phone,
        registrationNumber: args.registrationNumber,
        defaultTitle: args.defaultTitle,
      },
      execute,
    );
    json({
      ok: true,
      action: "clients.create",
      mode: execute ? "execute" : "dry-run",
      ...result,
    });
  }

  if (
    (resource === "documents" ||
      resource === "invoices" ||
      resource === "estimates") &&
    action === "create"
  ) {
    if (!args.input) fail("--input is required");
    const input = JSON.parse(fs.readFileSync(path.resolve(args.input), "utf8"));
    if (resource === "invoices") input.type = "invoice";
    if (resource === "estimates") input.type = "quote";
    const result = await createDocument(input, {
      execute,
      createClientIfMissing: args["create-client"] === true,
    });
    json(result);
  }

  fail("Unknown command", {
    usage: [
      "keiri template check --json",
      "keiri clients list --json",
      "keiri clients get --name NAME --json",
      "keiri clients create --name NAME [--execute] --json",
      "keiri invoices create --input invoice.json [--create-client] [--execute] --json",
      "keiri estimates create --input estimate.json [--create-client] [--execute] --json",
    ],
  });
}

main().catch((error) => fail(error.message));
