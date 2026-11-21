/**
 * 書類の作成・更新・削除・PDF の結合テスト（Repository → gateway.ts → 偽の窓口の Code.gs）。
 * 偽の窓口には書式のタブを用意する。sheetsApi.ts はモジュール変数を持つので、
 * このファイルでは 1 つの偽の窓口を使い回し、各テストは自分で作った会社・取引先だけを見る。
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { loadGateway } from "../../../apps-script/fake-apps-script.mjs";
import type { NewDocumentInput } from "../../domain/documents.ts";
import type { Issuer } from "../../domain/issuer.ts";
import type { Party } from "../../domain/party.ts";
import { memoryRepositories } from "../../repositories/memory.ts";
import { SHEET_NAMES } from "../../repositories/sheets/schema.ts";
import { sheetsRepositories as repos } from "../../repositories/sheets/index.ts";
import type { GatewayCall } from "../gateway.ts";
import { setGatewayTransport } from "../gateway.ts";
import {
  createDocument,
  exportDocumentPdf,
  removeDocument,
  updateDocument,
} from "./service.ts";

const KEY = "k".repeat(40);
const SPREADSHEET_ID = "1AbCdEfGhIjKlMnOpQrStUvWx";
const WEB_APP_URL = "https://script.google.com/macros/s/AKfycbTEST_id-1/exec";
const TEMPLATES = ["書式_請求書", "書式_見積書", "書式_領収書"];

const gateway = loadGateway({
  key: KEY,
  spreadsheetId: SPREADSHEET_ID,
  sheets: TEMPLATES.map((name) => ({
    name,
    rows: [[name], ["ダミー", "ダミー"], ["ダミー"]],
  })),
});
const requests: GatewayCall[][] = [];
const originalConnection = process.env.KEIRI_CONNECTION;

before(() => {
  process.env.KEIRI_CONNECTION = gateway.context.issueConnectionCode(
    WEB_APP_URL,
    false,
  );
  setGatewayTransport(async (_connection, body) => {
    requests.push((JSON.parse(body) as { calls: GatewayCall[] }).calls);
    return JSON.stringify(gateway.post(body));
  });
});

after(() => {
  setGatewayTransport(null);
  if (originalConnection === undefined) delete process.env.KEIRI_CONNECTION;
  else process.env.KEIRI_CONNECTION = originalConnection;
});

async function requestsDuring(
  fn: () => Promise<unknown>,
): Promise<GatewayCall[][]> {
  const mark = requests.length;
  await fn();
  return requests.slice(mark);
}

function rowCount(tab: string): number {
  return gateway.spreadsheet.getSheetByName(tab)?.values.length ?? 0;
}

function storedRow(tab: string, id: string): unknown[] | undefined {
  return gateway.spreadsheet
    .sheet(tab)
    .values.find((row: unknown[]) => row[0] === id);
}

/** 会社と取引先を 1 組作る。テストごとに別の組を使い、番号を独立させる。 */
async function seed(label: string): Promise<{ issuer: Issuer; party: Party }> {
  const issuer = await repos.issuers.create({
    name: `合同会社サンプル${label}`,
    address: "東京都サンプル区1-2-3",
    bankInfo: "テスト銀行 普通 1234567",
  });
  const party = await repos.parties.create({
    name: `株式会社サンプル商事${label}`,
    honorific: "御中",
  });
  return { issuer, party };
}

function input(
  issuer: Issuer,
  party: Party,
  overrides: Partial<NewDocumentInput> = {},
): NewDocumentInput {
  return {
    type: "invoice",
    issueDate: "2026-11-30",
    issuerId: issuer.id,
    partyId: party.id,
    title: "システム開発業務",
    items: [
      {
        name: "作業費",
        quantity: 2,
        unit: "式",
        unitPrice: 30000,
        taxRate: 0.1,
      },
    ],
    notes: "",
    ...overrides,
  };
}

function tabNames(): string[] {
  return gateway.spreadsheet.sheetNames();
}

test("createDocument は書類の行と帳票のタブを一緒に作り、行がタブを指す", async () => {
  const { issuer, party } = await seed("A");
  const doc = await createDocument(repos, input(issuer, party));

  assert.equal(doc.number, "0001");
  const tabName = `請求書_0001_${party.name}`;
  const tab = gateway.spreadsheet.sheet(tabName);
  const gid = String(tab.getSheetId());
  assert.equal(doc.generatedSheetName, tabName);
  assert.equal(doc.generatedSheetId, gid);
  assert.equal(doc.generatedSpreadsheetId, SPREADSHEET_ID);
  assert.equal(doc.templateSpreadsheetId, SPREADSHEET_ID);
  assert.equal(
    doc.sheetUrl,
    `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/edit#gid=${gid}`,
  );

  const saved = await repos.documents.get(doc.id);
  assert.equal(saved?.generatedSheetId, gid);
  assert.equal(saved?.generatedSheetName, tabName);
  assert.equal(saved?.sheetUrl, doc.sheetUrl);
  assert.equal(saved?.generatedSpreadsheetId, SPREADSHEET_ID);

  // 帳票の中身が、書式のタブの複製に書き込まれている
  assert.equal(tab.values[0][0], "請     求     書");
  assert.equal(tab.values[6][0], party.name);
  assert.equal(tab.values[12][1], 66000);
  assert.ok(tabNames().includes("書式_請求書"));
});

test("createDocument の窓口への要求は 3 回以内", async () => {
  const { issuer, party } = await seed("B");
  const sent = await requestsDuring(() =>
    createDocument(repos, input(issuer, party)),
  );
  assert.ok(sent.length <= 3, `要求は ${sent.length} 回`);
  const ops = sent.flat().map((call) => call.op);
  assert.equal(ops.filter((op) => op === "nextSeq").length, 1);
  assert.equal(ops.filter((op) => op === "renderSheet").length, 1);
});

test("createDocument は取引先が無ければ例外で、番号もタブも進まない", async () => {
  const { issuer, party } = await seed("C");
  const counters = rowCount(SHEET_NAMES.counters);
  const documents = rowCount(SHEET_NAMES.documents);
  const tabs = tabNames();

  const sent = await requestsDuring(() =>
    assert.rejects(
      () => createDocument(repos, input(issuer, { ...party, id: "no-party" })),
      /取引先が見つかりません/,
    ),
  );
  assert.deepEqual(
    sent.flat().filter((call) => call.op !== "read"),
    [],
  );
  assert.equal(rowCount(SHEET_NAMES.counters), counters);
  assert.equal(rowCount(SHEET_NAMES.documents), documents);
  assert.deepEqual(tabNames(), tabs);

  // 失敗した分の番号は欠番にならない
  const doc = await createDocument(repos, input(issuer, party));
  assert.equal(doc.number, "0001");
});

test("createDocument は発行元が無ければ例外で、番号もタブも進まない", async () => {
  const { issuer, party } = await seed("D");
  const counters = rowCount(SHEET_NAMES.counters);
  const documents = rowCount(SHEET_NAMES.documents);
  const tabs = tabNames();

  await assert.rejects(
    () => createDocument(repos, input({ ...issuer, id: "no-issuer" }, party)),
    /発行元が見つかりません/,
  );
  assert.equal(rowCount(SHEET_NAMES.counters), counters);
  assert.equal(rowCount(SHEET_NAMES.documents), documents);
  assert.deepEqual(tabNames(), tabs);
});

test("見積書と領収書も、書式のタブから帳票のタブを作る", async () => {
  const { issuer, party } = await seed("E");
  const quote = await createDocument(
    repos,
    input(issuer, party, { type: "quote", validUntil: "2026-12-31" }),
  );
  const receipt = await createDocument(
    repos,
    input(issuer, party, { type: "receipt", purpose: "システム開発費" }),
  );
  assert.equal(quote.generatedSheetName, `見積書_0001_${party.name}`);
  assert.equal(receipt.generatedSheetName, `領収書_0001_${party.name}`);
  assert.equal(
    gateway.spreadsheet.sheet(receipt.generatedSheetName!).values[6][3],
    "システム開発費として",
  );
});

test("updateDocument は内容を変えるとタブを作り直し、行は 1 行のまま更新する", async () => {
  const { issuer, party } = await seed("F");
  const doc = await createDocument(repos, input(issuer, party));
  const oldGid = doc.generatedSheetId!;
  const tabs = tabNames().length;
  const rows = rowCount(SHEET_NAMES.documents);

  const updated = await updateDocument(repos, doc.id, {
    title: "変更後の件名",
    items: [
      {
        name: "作業費",
        quantity: 2,
        unit: "式",
        unitPrice: 50000,
        taxRate: 0.1,
      },
    ],
  });

  assert.equal(updated.id, doc.id);
  assert.equal(updated.number, doc.number);
  assert.equal(updated.title, "変更後の件名");
  assert.notEqual(updated.generatedSheetId, oldGid);
  assert.ok(
    !gateway.spreadsheet
      .getSheets()
      .some(
        (sheet: { getSheetId(): number }) =>
          String(sheet.getSheetId()) === oldGid,
      ),
    "前のタブが残っている",
  );
  assert.equal(tabNames().length, tabs);
  assert.equal(rowCount(SHEET_NAMES.documents), rows);

  const saved = await repos.documents.get(doc.id);
  assert.equal(saved?.title, "変更後の件名");
  assert.equal(saved?.number, doc.number);
  assert.equal(saved?.generatedSheetId, updated.generatedSheetId);
  assert.equal(saved?.createdAt, doc.createdAt);

  const tab = gateway.spreadsheet.sheet(updated.generatedSheetName!);
  assert.equal(tab.values[12][1], 110000);
});

test("updateDocument は書類が無ければ例外", async () => {
  await assert.rejects(
    () => updateDocument(repos, "no-document", { title: "x" }),
    /帳票が見つかりません: no-document/,
  );
});

test("removeDocument は行とタブの両方を消し、書式のタブとほかの表は消さない", async () => {
  const { issuer, party } = await seed("G");
  const keep = await createDocument(repos, input(issuer, party));
  const target = await createDocument(repos, input(issuer, party));
  const tables = [
    SHEET_NAMES.parties,
    SHEET_NAMES.issuers,
    SHEET_NAMES.counters,
  ];
  const tableRows = tables.map(rowCount);

  await removeDocument(repos, target.id);

  assert.equal(await repos.documents.get(target.id), null);
  assert.equal(storedRow(SHEET_NAMES.documents, target.id), undefined);
  assert.ok(!tabNames().includes(target.generatedSheetName!));
  for (const template of TEMPLATES) assert.ok(tabNames().includes(template));
  assert.deepEqual(tables.map(rowCount), tableRows);
  assert.ok(await repos.documents.get(keep.id));
  assert.ok(tabNames().includes(keep.generatedSheetName!));
});

test("removeDocument は存在しない書類なら何もしない", async () => {
  const tabs = tabNames();
  const sent = await requestsDuring(() => removeDocument(repos, "no-document"));
  assert.deepEqual(
    sent.flat().filter((call) => call.op !== "read"),
    [],
  );
  assert.deepEqual(tabNames(), tabs);
});

test("exportDocumentPdf は帳票のタブから書き出した PDF のバイト列を返す", async () => {
  const { issuer, party } = await seed("H");
  const doc = await createDocument(repos, input(issuer, party));
  const pdf = await exportDocumentPdf(repos, doc);
  assert.ok(pdf instanceof Uint8Array);
  const text = new TextDecoder().decode(pdf);
  assert.ok(text.startsWith("%PDF-fake:"), text);
  assert.ok(text.includes(`gid=${doc.generatedSheetId}`), text);
});

test("exportDocumentPdf はタブの無い書類なら、先にタブを作って行に保存する", async () => {
  const { issuer, party } = await seed("I");
  const draft = await repos.documents.create(input(issuer, party));
  assert.equal(draft.generatedSheetId, undefined);
  const tabs = tabNames();

  const pdf = await exportDocumentPdf(repos, draft);

  assert.ok(new TextDecoder().decode(pdf).startsWith("%PDF-fake:"));
  const tabName = `請求書_0001_${party.name}`;
  assert.equal(tabNames().length, tabs.length + 1);
  const gid = String(gateway.spreadsheet.sheet(tabName).getSheetId());
  const saved = await repos.documents.get(draft.id);
  assert.equal(saved?.generatedSheetId, gid);
  assert.equal(saved?.generatedSheetName, tabName);
  assert.ok(saved?.sheetUrl?.endsWith(`#gid=${gid}`));
  assert.ok(new TextDecoder().decode(pdf).includes(`gid=${gid}`));
});

test("exportDocumentPdf はタブのある書類なら、タブを作り直さない", async () => {
  const { issuer, party } = await seed("J");
  const doc = await createDocument(repos, input(issuer, party));
  const sent = await requestsDuring(() => exportDocumentPdf(repos, doc));
  const ops = sent.flat().map((call) => call.op);
  assert.deepEqual(ops, ["exportPdf"]);
});

test("backend が memory のときは、窓口を呼ばずに書類だけを扱う", async () => {
  assert.equal(memoryRepositories.backend, "memory");
  const sent = await requestsDuring(async () => {
    const doc = await createDocument(memoryRepositories, {
      type: "invoice",
      issueDate: "2026-11-30",
      issuerId: "issuer-sample",
      partyId: "party-1",
      title: "メモリ上の書類",
      items: [],
      notes: "",
    });
    assert.equal(doc.generatedSheetId, undefined);
    assert.equal(doc.sheetUrl, undefined);
    assert.equal(doc.title, "メモリ上の書類");

    const updated = await updateDocument(memoryRepositories, doc.id, {
      title: "変更後",
    });
    assert.equal(updated.title, "変更後");
    assert.equal(updated.number, doc.number);

    await assert.rejects(
      () => exportDocumentPdf(memoryRepositories, updated),
      /デモでは PDF を作れません/,
    );

    await removeDocument(memoryRepositories, doc.id);
    assert.equal(await memoryRepositories.documents.get(doc.id), null);
  });
  assert.equal(sent.length, 0);
});

test("memory でも、取引先か発行元が無ければ作成は例外", async () => {
  const base: NewDocumentInput = {
    type: "invoice",
    issueDate: "2026-11-30",
    issuerId: "issuer-sample",
    partyId: "party-1",
    title: "x",
    items: [],
    notes: "",
  };
  await assert.rejects(
    () => createDocument(memoryRepositories, { ...base, partyId: "none" }),
    /取引先が見つかりません/,
  );
  await assert.rejects(
    () => createDocument(memoryRepositories, { ...base, issuerId: "none" }),
    /発行元が見つかりません/,
  );
});

test("exportDocumentPdf はタブが手で消されていたら、作り直して書き出す", async () => {
  const { issuer, party } = await seed("M");
  const doc = await createDocument(repos, input(issuer, party));
  const tab = gateway.spreadsheet.sheet(doc.generatedSheetName!);
  gateway.spreadsheet.deleteSheet(tab);

  const pdf = await exportDocumentPdf(repos, doc);

  const saved = await repos.documents.get(doc.id);
  assert.notEqual(saved?.generatedSheetId, doc.generatedSheetId);
  assert.ok(
    new TextDecoder().decode(pdf).includes(`gid=${saved?.generatedSheetId}`),
  );
});
