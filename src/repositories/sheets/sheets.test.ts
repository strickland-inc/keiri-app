/**
 * Repository → gateway.ts → 偽の窓口（apps-script/Code.gs）の結合テスト。
 * sheetsApi.ts はモジュール変数を持つので、このファイルでは 1 つの偽の窓口を使い回す。
 * 各テストは、自分で作った id と、会社 id を分けた書類だけを見る。
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { loadGateway } from "../../../apps-script/fake-apps-script.mjs";
import { GatewayError, setGatewayTransport } from "../../lib/gateway.ts";
import type { GatewayCall } from "../../lib/gateway.ts";
import type {
  DocumentRecord,
  NewDocumentInput,
} from "../../domain/documents.ts";
import type { NewExpenseInput } from "../../domain/expense.ts";
import { SHEET_NAMES, TABLES, documentToRow } from "./schema.ts";
import { sheetsRepositories as repos } from "./index.ts";

const KEY = "k".repeat(40);
const SPREADSHEET_ID = "1AbCdEfGhIjKlMnOpQrStUvWx";
const WEB_APP_URL = "https://script.google.com/macros/s/AKfycbTEST_id-1/exec";

const gateway = loadGateway({ key: KEY, spreadsheetId: SPREADSHEET_ID });
const requests: GatewayCall[][] = [];
const failure: { next: { code: string; message: string } | null } = {
  next: null,
};
const originalConnection = process.env.KEIRI_CONNECTION;

before(() => {
  process.env.KEIRI_CONNECTION = gateway.context.issueConnectionCode(
    WEB_APP_URL,
    false,
  );
  setGatewayTransport(async (_connection, body) => {
    requests.push((JSON.parse(body) as { calls: GatewayCall[] }).calls);
    if (failure.next) {
      const error = failure.next;
      failure.next = null;
      return JSON.stringify({ ok: false, v: 1, error });
    }
    return JSON.stringify(gateway.post(body));
  });
});

after(() => {
  setGatewayTransport(null);
  if (originalConnection === undefined) delete process.env.KEIRI_CONNECTION;
  else process.env.KEIRI_CONNECTION = originalConnection;
});

/** undefined のキーを落とした、比較用の複製。 */
function plain<T>(value: T): unknown {
  return JSON.parse(JSON.stringify(value));
}

function rowCount(tab: string): number {
  return gateway.spreadsheet.getSheetByName(tab)?.values.length ?? 0;
}

/** 表のタブを作らせるために、何か 1 つ読んでおく。 */
async function warm(): Promise<void> {
  await repos.settings.all();
}

/** fn の間に窓口へ送られた要求。 */
async function requestsDuring(
  fn: () => Promise<unknown>,
): Promise<GatewayCall[][]> {
  const mark = requests.length;
  await fn();
  return requests.slice(mark);
}

function readTabs(request: GatewayCall[]): string[] {
  return request
    .flatMap((call) => (call.op === "read" ? call.tabs : []))
    .sort();
}

function storedRow(tab: string, id: string): unknown[] | undefined {
  return gateway.spreadsheet
    .sheet(tab)
    .values.find((row: unknown[]) => row[0] === id);
}

function appendToGateway(tab: string, rows: string[][]): void {
  const response = gateway.post({
    key: KEY,
    calls: [{ op: "append", tab, rows }],
  });
  assert.equal(response.ok, true, JSON.stringify(response));
}

const expenseInput: NewExpenseInput = {
  issuerId: "issuer-expense",
  date: "2026-11-12",
  merchant: "=1+1",
  amount: 1500,
  category: "消耗品費",
  source: "カード",
  note: "文房具 😀\n2 行目",
};

function documentInput(
  issuerId: string,
  type: DocumentRecord["type"] = "invoice",
): NewDocumentInput {
  return {
    type,
    issueDate: "2026-11-30",
    issuerId,
    partyId: "party-numbering",
    title: "システム開発業務",
    items: [
      {
        name: "作業費",
        quantity: 1,
        unit: "式",
        unitPrice: 1000,
        taxRate: 0.1,
      },
    ],
    notes: "",
  };
}

test("最初の要求で、足りないタブが見出しつきで作られ、ensureTabs は 1 回だけ送られる", async () => {
  const first = await requestsDuring(() => repos.parties.list());
  assert.equal(first.length, 1);
  assert.deepEqual(
    first[0].map((call) => call.op),
    ["ensureTabs", "read"],
  );
  for (const table of TABLES) {
    assert.deepEqual(
      gateway.spreadsheet.sheet(table.name).values[0],
      [...table.header],
      table.name,
    );
  }

  await repos.expenses.list();
  await repos.settings.set("ensure.check", "1");
  const ensureCount = requests
    .flat()
    .filter((call) => call.op === "ensureTabs").length;
  assert.equal(ensureCount, 1);
});

test("取引先が往復し、値が文字列のまま保たれる", async () => {
  const created = await repos.parties.create({
    name: "=1+1",
    contactName: "山田 太郎",
    honorific: "様",
    postalCode: "0022",
    address: "東京都サンプル区1-2-3\nサンプルビル 😀",
    phone: "03-0000-0000",
    registrationNumber: "T0123456789012",
    defaultTitle: "2026-11-12",
  });

  const stored = storedRow(SHEET_NAMES.parties, created.id);
  assert.equal(stored?.[1], "=1+1");
  assert.equal(stored?.[4], "0022");
  assert.equal(stored?.[8], "T0123456789012");

  const listed = await repos.parties.list();
  assert.ok(listed.some((party) => party.id === created.id));
  const got = await repos.parties.get(created.id);
  assert.deepEqual(plain(got), plain(created));

  const before = rowCount(SHEET_NAMES.parties);
  const updated = await repos.parties.update(created.id, {
    name: "株式会社サンプル商事",
    postalCode: "0033",
  });
  assert.equal(updated.name, "株式会社サンプル商事");
  assert.equal(updated.createdAt, created.createdAt);
  assert.equal(updated.address, created.address);
  assert.equal(rowCount(SHEET_NAMES.parties), before);
  assert.deepEqual(plain(await repos.parties.get(created.id)), plain(updated));

  await repos.parties.remove(created.id);
  assert.equal(await repos.parties.get(created.id), null);
  assert.equal(rowCount(SHEET_NAMES.parties), before - 1);
});

test("発行元が往復し、改行を含む振込先がそのまま保たれる", async () => {
  const bankInfo =
    "テスト銀行 サンプル支店\n普通 1234567\nゴウドウガイシャサンプル 😀";
  const created = await repos.issuers.create({
    name: "合同会社サンプル",
    signatoryName: "山田太郎",
    postalCode: "0123",
    address: "東京都サンプル区1-2-3",
    bankInfo,
    isDefault: true,
    fiscalYearEndMonth: 9,
    firstFiscalYearEnd: "2023-09-30",
  });
  assert.equal(storedRow(SHEET_NAMES.issuers, created.id)?.[8], bankInfo);

  assert.ok((await repos.issuers.list()).some((i) => i.id === created.id));
  const got = await repos.issuers.get(created.id);
  assert.equal(got?.bankInfo, bankInfo);
  assert.equal(got?.isDefault, true);
  assert.equal(got?.fiscalYearEndMonth, 9);
  assert.deepEqual(plain(got), plain(created));
  assert.ok(await repos.issuers.getDefault());

  const updated = await repos.issuers.update(created.id, {
    phone: "03-0000-0000",
  });
  assert.equal(updated.phone, "03-0000-0000");
  assert.equal(updated.bankInfo, bankInfo);
  assert.deepEqual(plain(await repos.issuers.get(created.id)), plain(updated));

  await repos.issuers.remove(created.id);
  assert.equal(await repos.issuers.get(created.id), null);
});

test("経費が往復し、日付と数式に見える文字列がそのまま保たれる", async () => {
  const created = await repos.expenses.create(expenseInput);
  const stored = storedRow(SHEET_NAMES.expenses, created.id);
  assert.equal(stored?.[1], "2026-11-12");
  assert.equal(stored?.[2], "=1+1");

  const listed = await repos.expenses.list({ issuerId: "issuer-expense" });
  assert.ok(listed.some((expense) => expense.id === created.id));
  const got = await repos.expenses.get(created.id);
  assert.equal(got?.merchant, "=1+1");
  assert.equal(got?.date, "2026-11-12");
  assert.equal(got?.note, expenseInput.note);
  assert.equal(got?.amount, 1500);
  assert.deepEqual(plain(got), plain(created));

  const updated = await repos.expenses.update(created.id, {
    amount: 2200,
    category: "会議費",
  });
  assert.equal(updated.amount, 2200);
  assert.equal(updated.merchant, "=1+1");
  assert.deepEqual(plain(await repos.expenses.get(created.id)), plain(updated));

  await repos.expenses.remove(created.id);
  assert.equal(await repos.expenses.get(created.id), null);
});

test("売上が往復する", async () => {
  const created = await repos.revenues.create({
    issuerId: "issuer-revenue",
    date: "2026-11-12",
    partyName: "株式会社サンプル商事",
    amount: 66000,
    description: "システム開発 😀",
    source: "手入力",
  });
  assert.ok(
    (await repos.revenues.list({ issuerId: "issuer-revenue" })).some(
      (revenue) => revenue.id === created.id,
    ),
  );
  assert.deepEqual(plain(await repos.revenues.get(created.id)), plain(created));

  const updated = await repos.revenues.update(created.id, { amount: 77000 });
  assert.equal(updated.amount, 77000);
  assert.equal(updated.date, "2026-11-12");

  await repos.revenues.remove(created.id);
  assert.equal(await repos.revenues.get(created.id), null);
});

test("銀行明細が往復する", async () => {
  const [created] = await repos.bankTransactions.bulkCreate([
    {
      key: "2026-11-12|-1500|カード|98500#1",
      date: "2026-11-12",
      seq: 0,
      description: "テスト銀行 普通 1234567",
      amount: -1500,
      balance: 98500,
      account: "消耗品費",
      confidence: 0.9,
      method: "rule",
      needsReview: false,
    },
  ]);
  assert.ok(
    (await repos.bankTransactions.list()).some((tx) => tx.id === created.id),
  );
  assert.deepEqual(
    plain(await repos.bankTransactions.get(created.id)),
    plain(created),
  );

  const updated = await repos.bankTransactions.update(created.id, {
    account: "雑費",
    needsReview: true,
  });
  assert.equal(updated.account, "雑費");
  assert.equal(updated.needsReview, true);
  assert.equal(updated.amount, -1500);

  await repos.bankTransactions.remove(created.id);
  assert.equal(await repos.bankTransactions.get(created.id), null);
});

test("設定が往復し、値が文字列のまま保たれる", async () => {
  await repos.settings.set("往復.0022", "0022");
  await repos.settings.set("往復.date", "2026-11-12");
  await repos.settings.set("往復.formula", "=1+1");
  await repos.settings.set("往復.multi", "1 行目\n2 行目 😀");

  assert.equal(await repos.settings.get("往復.0022"), "0022");
  assert.equal(await repos.settings.get("往復.date"), "2026-11-12");
  assert.equal(await repos.settings.get("往復.formula"), "=1+1");
  assert.equal(await repos.settings.get("往復.multi"), "1 行目\n2 行目 😀");
  assert.equal(await repos.settings.get("往復.none"), null);

  const all = await repos.settings.all();
  assert.equal(all["往復.formula"], "=1+1");
});

test("学習辞書が往復する", async () => {
  const saved = await repos.merchantRules.upsert({
    key: "さんぷる=1+1",
    sampleMerchant: "サンプル商店 😀",
    category: "消耗品費",
  });
  assert.deepEqual(
    plain(await repos.merchantRules.get("さんぷる=1+1")),
    plain(saved),
  );
  assert.ok(
    (await repos.merchantRules.all()).some((rule) => rule.key === saved.key),
  );

  const updated = await repos.merchantRules.upsert({
    key: "さんぷる=1+1",
    sampleMerchant: "サンプル商店",
    category: "会議費",
  });
  assert.equal((await repos.merchantRules.get(saved.key))?.category, "会議費");
  assert.equal(updated.category, "会議費");
});

test("ユーザーが往復する", async () => {
  const created = await repos.users.create({
    loginId: "0022",
    displayName: "テスト",
    passwordHash: "pbkdf2$100000$c2FtcGxl$aGFzaA==",
    role: "admin",
  });
  assert.equal(storedRow(SHEET_NAMES.users, created.id)?.[1], "0022");
  assert.ok((await repos.users.list()).some((user) => user.id === created.id));
  assert.deepEqual(plain(await repos.users.get(created.id)), plain(created));
  assert.equal((await repos.users.findByLoginId("0022"))?.id, created.id);
  assert.equal(await repos.users.findByLoginId("存在しない"), null);

  await repos.users.remove(created.id);
  assert.equal(await repos.users.get(created.id), null);
});

test("API トークンが往復する", async () => {
  const created = await repos.apiTokens.create({
    name: "エージェント用 😀",
    tokenHash: "0".repeat(64),
  });
  const listed = await repos.apiTokens.list();
  assert.deepEqual(
    plain(listed.find((token) => token.id === created.id)),
    plain(created),
  );
  assert.equal(
    listed.find((token) => token.id === created.id)?.tokenHash,
    "0".repeat(64),
  );

  await repos.apiTokens.remove(created.id);
  assert.ok(!(await repos.apiTokens.list()).some((t) => t.id === created.id));
});

test("expenses.bulkCreate は何件でも窓口への要求が 1 回", async () => {
  await warm();
  for (const count of [1, 30, 120]) {
    const inputs = Array.from({ length: count }, (_, index) => ({
      ...expenseInput,
      merchant: `店${index}`,
    }));
    const before = rowCount(SHEET_NAMES.expenses);
    let created: unknown[] = [];
    const sent = await requestsDuring(async () => {
      created = await repos.expenses.bulkCreate(inputs);
    });
    assert.equal(sent.length, 1, `${count} 件`);
    assert.equal(created.length, count);
    assert.equal(rowCount(SHEET_NAMES.expenses), before + count);
  }
});

test("expenses.bulkCreate は空なら窓口を呼ばない", async () => {
  await warm();
  const sent = await requestsDuring(() => repos.expenses.bulkCreate([]));
  assert.equal(sent.length, 0);
});

test("settings.set は新規でも更新でも要求が 1 回で、更新では行が増えない", async () => {
  await warm();
  const rows = rowCount(SHEET_NAMES.settings);
  const created = await requestsDuring(() =>
    repos.settings.set("回数.key", "1"),
  );
  assert.equal(created.length, 1);
  assert.equal(rowCount(SHEET_NAMES.settings), rows + 1);

  const updated = await requestsDuring(() =>
    repos.settings.set("回数.key", "2"),
  );
  assert.equal(updated.length, 1);
  assert.equal(rowCount(SHEET_NAMES.settings), rows + 1);
  assert.equal(await repos.settings.get("回数.key"), "2");
});

test("merchantRules.upsert は新規でも更新でも要求が 1 回で、更新では行が増えない", async () => {
  await warm();
  const input = {
    key: "回数ルール",
    sampleMerchant: "店",
    category: "雑費",
  } as const;
  const rows = rowCount(SHEET_NAMES.merchantRules);
  const created = await requestsDuring(() => repos.merchantRules.upsert(input));
  assert.equal(created.length, 1);
  assert.equal(rowCount(SHEET_NAMES.merchantRules), rows + 1);

  const updated = await requestsDuring(() =>
    repos.merchantRules.upsert({ ...input, category: "会議費" }),
  );
  assert.equal(updated.length, 1);
  assert.equal(rowCount(SHEET_NAMES.merchantRules), rows + 1);
});

test("書類の採番は、同じ会社・同じ種類で 0001, 0002 と進む", async () => {
  const a = await repos.documents.create(documentInput("issuer-seq-a"));
  const b = await repos.documents.create(documentInput("issuer-seq-a"));
  assert.deepEqual([a.number, b.number], ["0001", "0002"]);
  assert.equal(storedRow(SHEET_NAMES.documents, a.id)?.[2], "0001");
});

test("書類の採番は、会社か種類が違えば別の連番", async () => {
  const first = await repos.documents.create(documentInput("issuer-seq-b"));
  const otherCompany = await repos.documents.create(
    documentInput("issuer-seq-c"),
  );
  const otherType = await repos.documents.create(
    documentInput("issuer-seq-b", "quote"),
  );
  const second = await repos.documents.create(documentInput("issuer-seq-b"));
  assert.equal(first.number, "0001");
  assert.equal(otherCompany.number, "0001");
  assert.equal(otherType.number, "0001");
  assert.equal(second.number, "0002");
});

test("カウンターの行が無くても、既にある書類の最大番号の続きから振る", async () => {
  await warm();
  const existing = (number: string): DocumentRecord => ({
    ...documentInput("issuer-seq-d"),
    id: `existing-${number}`,
    number,
    status: "issued",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
  appendToGateway(SHEET_NAMES.documents, [
    documentToRow(existing("0003")),
    documentToRow(existing("0007")),
  ]);
  const next = await repos.documents.create(documentInput("issuer-seq-d"));
  assert.equal(next.number, "0008");
  const after = await repos.documents.create(documentInput("issuer-seq-d"));
  assert.equal(after.number, "0009");
});

test("書類を消しても番号は戻らない", async () => {
  const first = await repos.documents.create(documentInput("issuer-seq-e"));
  await repos.documents.remove(first.id);
  const second = await repos.documents.create(documentInput("issuer-seq-e"));
  assert.equal(second.number, "0002");
});

test("Promise.all で同時に 5 件作っても、番号が重複しない", async () => {
  const created = await Promise.all(
    Array.from({ length: 5 }, () =>
      repos.documents.create(documentInput("issuer-seq-f")),
    ),
  );
  assert.deepEqual(created.map((doc) => doc.number).sort(), [
    "0001",
    "0002",
    "0003",
    "0004",
    "0005",
  ]);
  const stored = (await repos.documents.list({ issuerId: "issuer-seq-f" })).map(
    (doc) => doc.number,
  );
  assert.equal(new Set(stored).size, 5);
});

test("同じ瞬間に出した複数の表の読み取りが、窓口への要求 1 回にまとまる", async () => {
  await warm();
  const sent = await requestsDuring(() =>
    Promise.all([
      repos.expenses.list(),
      repos.revenues.list(),
      repos.bankTransactions.list(),
    ]),
  );
  assert.equal(sent.length, 1);
  assert.deepEqual(readTabs(sent[0]), [
    SHEET_NAMES.bankTransactions,
    SHEET_NAMES.expenses,
    SHEET_NAMES.revenues,
  ]);
});

test("大きい表を 1 つだけ読むときは、その表だけを読む", async () => {
  await warm();
  const sent = await requestsDuring(() => repos.expenses.list());
  assert.equal(sent.length, 1);
  assert.deepEqual(readTabs(sent[0]), [SHEET_NAMES.expenses]);
});

test("小さい表は、どれか 1 つを読むと残りも同じ要求で読まれる", async () => {
  await warm();
  const readers = {
    issuers: () => repos.issuers.list(),
    parties: () => repos.parties.list(),
    documents: () => repos.documents.list(),
    settings: () => repos.settings.all(),
    users: () => repos.users.list(),
  };
  for (const [name, read] of Object.entries(readers)) {
    const sent = await requestsDuring(read);
    assert.equal(sent.length, 1, name);
    assert.deepEqual(
      readTabs(sent[0]),
      [
        SHEET_NAMES.documents,
        SHEET_NAMES.issuers,
        SHEET_NAMES.parties,
        SHEET_NAMES.sessionVersions,
        SHEET_NAMES.settings,
        SHEET_NAMES.userAccess,
        SHEET_NAMES.userProfiles,
        SHEET_NAMES.userSecurity,
        SHEET_NAMES.users,
      ],
      name,
    );
  }
});

test("見つからない id の更新は例外になり、書き込みは送られない", async () => {
  await warm();
  const updates: Array<[string, () => Promise<unknown>]> = [
    ["取引先", () => repos.parties.update("none", { name: "x" })],
    ["発行元", () => repos.issuers.update("none", { name: "x" })],
    ["帳票", () => repos.documents.update("none", { title: "x" })],
    ["経費", () => repos.expenses.update("none", { note: "x" })],
    ["売上", () => repos.revenues.update("none", { description: "x" })],
    ["銀行明細", () => repos.bankTransactions.update("none", { account: "x" })],
  ];
  const sent = await requestsDuring(async () => {
    for (const [label, update] of updates) {
      await assert.rejects(
        update,
        new RegExp(`${label}が見つかりません: none`),
        label,
      );
    }
  });
  const writes = sent.flat().filter((call) => call.op !== "read");
  assert.deepEqual(writes, []);
});

test("窓口が ok:false を返したら GatewayError が上がる", async () => {
  await warm();
  failure.next = {
    code: "busy",
    message: "ほかの書き込みが終わりませんでした",
  };
  await assert.rejects(
    () => repos.expenses.list(),
    (error: unknown) =>
      error instanceof GatewayError &&
      error.code === "busy" &&
      error.message === "ほかの書き込みが終わりませんでした",
  );

  failure.next = { code: "internal", message: "内部エラー" };
  await assert.rejects(
    () => repos.expenses.create(expenseInput),
    (error: unknown) =>
      error instanceof GatewayError && error.code === "internal",
  );
});

test("鍵が違えば、窓口が unauthorized を返して GatewayError になる", async () => {
  await warm();
  const other = loadGateway({
    key: "z".repeat(40),
    spreadsheetId: SPREADSHEET_ID,
  });
  const correct = process.env.KEIRI_CONNECTION;
  process.env.KEIRI_CONNECTION = other.context.issueConnectionCode(
    WEB_APP_URL,
    false,
  );
  try {
    await assert.rejects(
      () => repos.expenses.list(),
      (error: unknown) =>
        error instanceof GatewayError && error.code === "unauthorized",
    );
  } finally {
    process.env.KEIRI_CONNECTION = correct;
  }
  assert.ok(Array.isArray(await repos.expenses.list()));
});
