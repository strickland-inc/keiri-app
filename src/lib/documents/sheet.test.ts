import assert from "node:assert/strict";
import test from "node:test";
import type { DocumentRecord, LineItem } from "../../domain/documents.ts";
import type { Issuer } from "../../domain/issuer.ts";
import type { Party } from "../../domain/party.ts";
import type { SheetStep } from "../gateway.ts";
import {
  planDocumentSheet,
  templateSheetName,
  type DocumentSheetPlan,
} from "./sheet.ts";

const TS = "2026-11-01T00:00:00.000Z";

const issuer: Issuer = {
  id: "issuer-1",
  name: "合同会社サンプル",
  postalCode: "123-4567",
  address: "東京都サンプル区1-2-3",
  bankInfo: "テスト銀行 サンプル支店\n普通 1234567\nゴウドウガイシャサンプル",
  createdAt: TS,
  updatedAt: TS,
};

const party: Party = {
  id: "party-1",
  name: "株式会社サンプル商事",
  postalCode: "100-0001",
  address: "東京都千代田区1-1-1",
  createdAt: TS,
  updatedAt: TS,
};

const item: LineItem = {
  name: "システム開発作業費",
  quantity: 2,
  unit: "式",
  unitPrice: 30000,
  taxRate: 0.1,
};

function makeItems(count: number): LineItem[] {
  return Array.from({ length: count }, (_, index) => ({
    name: `作業${index + 1}`,
    quantity: 1,
    unitPrice: 1000,
    taxRate: 0.1,
  }));
}

function makeDoc(overrides: Partial<DocumentRecord> = {}): DocumentRecord {
  return {
    id: "doc-1",
    type: "invoice",
    number: "0001",
    issueDate: "2026-11-30",
    issuerId: issuer.id,
    partyId: party.id,
    title: "システム開発業務",
    items: [item],
    notes: "",
    status: "draft",
    createdAt: TS,
    updatedAt: TS,
    ...overrides,
  };
}

function plan(
  docOverrides: Partial<DocumentRecord> = {},
  issuerOverrides: Partial<Issuer> = {},
  partyOverrides: Partial<Party> = {},
): DocumentSheetPlan {
  return planDocumentSheet({
    doc: makeDoc(docOverrides),
    issuer: { ...issuer, ...issuerOverrides },
    party: { ...party, ...partyOverrides },
  });
}

type ValuesStep = Extract<SheetStep, { do: "values" }>;

function valuesStepOf(result: DocumentSheetPlan): ValuesStep {
  const step = result.steps.find((s): s is ValuesStep => s.do === "values");
  assert.ok(step, "values の手順がありません");
  return step;
}

/** A1 表記のセルの値。範囲は A1 から始まる前提。 */
function cell(result: DocumentSheetPlan, a1: string): string | number {
  const match = /^([A-Z]+)(\d+)$/.exec(a1);
  assert.ok(match, a1);
  const column = [...match[1]].reduce(
    (n, letter) => n * 26 + letter.charCodeAt(0) - 64,
    0,
  );
  return valuesStepOf(result).values[Number(match[2]) - 1][column - 1];
}

function stepIndex(result: DocumentSheetPlan, kind: SheetStep["do"]): number {
  return result.steps.findIndex((s) => s.do === kind);
}

test("請求書の書式と作るタブの名前", () => {
  const result = plan();
  assert.equal(templateSheetName("invoice"), "書式_請求書");
  assert.equal(result.template, "書式_請求書");
  assert.equal(result.name, "請求書_0001_株式会社サンプル商事");
});

test("タブ名に使えない文字は除き、長すぎる名前は切る", () => {
  const result = plan({}, {}, { name: "サンプル[商事]*/\\?:株式会社" });
  assert.equal(result.name, "請求書_0001_サンプル商事株式会社");

  const long = plan({}, {}, { name: "あ".repeat(200) });
  assert.equal(long.name.length, 90);
});

test("請求書の values は A1:H40 で 40 行 × 8 列", () => {
  const step = valuesStepOf(plan());
  assert.equal(step.range, "A1:H40");
  assert.equal(step.values.length, 40);
  for (const line of step.values) assert.equal(line.length, 8);
});

test("請求書の各セルに、題・宛先・番号・金額・振込先・明細・備考が入る", () => {
  const result = plan({ notes: "お振込手数料はご負担ください" });
  assert.equal(cell(result, "A1"), "請     求     書");
  assert.equal(cell(result, "A7"), "株式会社サンプル商事");
  assert.equal(cell(result, "A8"), "御中");
  assert.equal(cell(result, "A11"), "下記の通りご請求申し上げます。");
  assert.equal(cell(result, "A13"), "ご請求金額");
  assert.equal(cell(result, "H4"), "2026年11月30日");
  // 先頭の ' は、番号の先頭の 0 が落ちないようにする印
  assert.equal(cell(result, "H5"), "0001");
  assert.equal(cell(result, "B13"), 66000);
  assert.equal(cell(result, "G32"), 60000);
  assert.equal(cell(result, "G33"), 6000);
  assert.equal(cell(result, "G34"), 66000);
  assert.equal(cell(result, "F13"), "振込先");
  assert.equal(cell(result, "G13"), issuer.bankInfo);
  assert.equal(cell(result, "A17"), "システム開発作業費");
  assert.equal(cell(result, "F17"), "2式");
  assert.equal(cell(result, "G17"), 30000);
  assert.equal(cell(result, "H17"), 60000);
  assert.equal(cell(result, "A37"), "お振込手数料はご負担ください");
});

test("発行元の会社名と住所は F 列に入る", () => {
  const result = plan({}, { phone: "03-0000-0000", email: "info@example.com" });
  assert.equal(cell(result, "F7"), "合同会社サンプル");
  assert.equal(cell(result, "F8"), "〒123-4567");
  assert.equal(cell(result, "F9"), "東京都サンプル区1-2-3");
  assert.equal(cell(result, "F10"), "電  話：");
  assert.equal(cell(result, "G10"), "03-0000-0000");
  assert.equal(cell(result, "F11"), "E-mail：");
  assert.equal(cell(result, "G11"), "info@example.com");
});

test("記載名義があると F8 に名義が入り、郵便番号以下が 1 行下がる", () => {
  const result = plan(
    {},
    {
      signatoryName: "山田太郎",
      phone: "03-0000-0000",
      email: "info@example.com",
    },
  );
  assert.equal(cell(result, "F7"), "合同会社サンプル");
  assert.equal(cell(result, "F8"), "山田太郎");
  assert.equal(cell(result, "F9"), "〒123-4567");
  assert.equal(cell(result, "F10"), "東京都サンプル区1-2-3");
  assert.equal(cell(result, "F11"), "電  話：");
  assert.equal(cell(result, "G11"), "03-0000-0000");
  assert.equal(cell(result, "F12"), "E-mail：");
  assert.equal(cell(result, "G12"), "info@example.com");
  // 13 行目の「振込先」には届かない
  assert.equal(cell(result, "F13"), "振込先");
});

test("明細が 14 件までなら行を足さない", () => {
  for (const count of [1, 14]) {
    const result = plan({ items: makeItems(count) });
    assert.equal(stepIndex(result, "insertRowsAfter"), -1, `${count} 件`);
    assert.equal(valuesStepOf(result).range, "A1:H40");
  }
});

test("明細が 15 件なら 1 行足す", () => {
  const result = plan({ items: makeItems(15) });
  const insert = result.steps.find((s) => s.do === "insertRowsAfter");
  assert.deepEqual(insert, { do: "insertRowsAfter", row: 30, count: 1 });
  assert.equal(valuesStepOf(result).range, "A1:H41");
  assert.equal(cell(result, "A31"), "作業15");
});

test("明細が 16 件なら 2 行足し、16 件すべてが values に入る", () => {
  const result = plan({ items: makeItems(16) });
  const insert = result.steps.find((s) => s.do === "insertRowsAfter");
  assert.deepEqual(insert, { do: "insertRowsAfter", row: 30, count: 2 });
  assert.ok(
    stepIndex(result, "insertRowsAfter") < stepIndex(result, "values"),
    "行の追加は values より前",
  );

  const step = valuesStepOf(result);
  assert.equal(step.range, "A1:H42");
  assert.equal(step.values.length, 42);

  for (let n = 1; n <= 16; n++) {
    assert.equal(cell(result, `A${16 + n}`), `作業${n}`, `${n} 件目`);
    assert.equal(cell(result, `H${16 + n}`), 1000, `${n} 件目の金額`);
  }
  assert.equal(cell(result, "F34"), "小計");
  assert.equal(cell(result, "G34"), 16000);
  assert.equal(cell(result, "G35"), 1600);
  assert.equal(cell(result, "G36"), 17600);
  assert.equal(cell(result, "A38"), "備考");
  assert.equal(cell(result, "B13"), 17600);

  const hide = result.steps.find((s) => s.do === "hideRows");
  assert.deepEqual(hide, { do: "hideRows", from: 40, count: 3 });
  const show = result.steps.find((s) => s.do === "showRows");
  assert.deepEqual(show, { do: "showRows", from: 38, count: 2 });
});

test("16 件のとき、備考は 39 行目で、足した行の左側を結合する", () => {
  const result = plan({ items: makeItems(16), notes: "備考の本文" });
  assert.equal(cell(result, "A39"), "備考の本文");
  const merges = result.steps.flatMap((s) =>
    s.do === "merge" ? [s.range] : [],
  );
  assert.deepEqual(merges, ["A31:E31", "A32:E32", "A39:H39"]);
  assert.deepEqual(
    result.steps.find((s) => s.do === "rowHeight"),
    { do: "rowHeight", row: 39, px: 96 },
  );
});

test("最初の手順は備考欄の unmerge で、values より前", () => {
  for (const count of [1, 16]) {
    const result = plan({ items: makeItems(count) });
    assert.deepEqual(result.steps[0], { do: "unmerge", range: "A36:H40" });
    assert.ok(stepIndex(result, "unmerge") < stepIndex(result, "values"));
  }
});

test("見積書は題が「御     見     積     書」で、振込先を出さない", () => {
  const result = plan({
    type: "quote",
    paymentTerms: "納品後 30 日以内",
    validUntil: "2026-12-31",
  });
  assert.equal(result.template, "書式_見積書");
  assert.equal(result.name, "見積書_0001_株式会社サンプル商事");
  assert.equal(cell(result, "A1"), "御     見     積     書");
  assert.equal(cell(result, "A11"), "下記の通りお見積申し上げます。");
  assert.equal(cell(result, "A13"), "お見積金額");
  assert.equal(cell(result, "F13"), "支払条件");
  assert.equal(cell(result, "G13"), "納品後 30 日以内");
  assert.equal(cell(result, "F14"), "有効期限");
  assert.equal(cell(result, "G14"), "2026年12月31日");
  const texts = valuesStepOf(result).values.flat();
  assert.ok(!texts.includes("振込先"));
  assert.ok(!texts.includes(issuer.bankInfo!));
});

test("見積書は支払条件も有効期限も無ければ、F13 と F14 は空", () => {
  const result = plan({ type: "quote" });
  assert.equal(cell(result, "F13"), "");
  assert.equal(cell(result, "G13"), "");
  assert.equal(cell(result, "F14"), "");
});

test("請求書の支払期日は F14 に入る", () => {
  const result = plan({ dueDate: "2026-12-25" });
  assert.equal(cell(result, "F14"), "支払期日");
  assert.equal(cell(result, "G14"), "2026年12月25日");
});

test("納品書と発注書は、A11 の文と A13 の見出しが種類ごとに違う", () => {
  const delivery = plan({ type: "delivery_note" });
  assert.equal(delivery.template, "書式_納品書");
  assert.equal(cell(delivery, "A1"), "納     品     書");
  assert.equal(cell(delivery, "A11"), "下記の通り納品いたします。");
  assert.equal(cell(delivery, "A13"), "合計金額");

  const order = plan({ type: "purchase_order" });
  assert.equal(order.template, "書式_発注書");
  assert.equal(cell(order, "A1"), "発     注     書");
  assert.equal(cell(order, "A11"), "下記の通り発注いたします。");
  assert.equal(cell(order, "A13"), "合計金額");

  for (const result of [delivery, order]) {
    assert.equal(cell(result, "F13"), "");
  }
});

test("登録番号がある発行元の請求書は、備考の先頭に登録番号と税率ごとの内訳を入れる", () => {
  const result = plan(
    {
      items: [
        item,
        { name: "書籍", quantity: 1, unitPrice: 10000, taxRate: 0.08 },
        { name: "非課税の立替", quantity: 1, unitPrice: 500, taxRate: 0 },
      ],
      notes: "お振込手数料はご負担ください",
    },
    { registrationNumber: "T1234567890123" },
  );
  assert.equal(
    cell(result, "A37"),
    [
      "登録番号：T1234567890123",
      "8%対象 ¥10,000（消費税 ¥800）",
      "10%対象 ¥60,000（消費税 ¥6,000）",
      "お振込手数料はご負担ください",
    ].join("\n"),
  );
});

test("登録番号がある発行元でも、利用者の備考が空なら内訳だけ", () => {
  const result = plan({}, { registrationNumber: "T1234567890123" });
  assert.equal(
    cell(result, "A37"),
    "登録番号：T1234567890123\n10%対象 ¥60,000（消費税 ¥6,000）",
  );
});

test("登録番号が無ければ、備考は利用者の備考だけ", () => {
  const result = plan({ notes: "お振込手数料はご負担ください" });
  assert.equal(cell(result, "A37"), "お振込手数料はご負担ください");
  assert.equal(cell(plan({ notes: "" }), "A37"), "");
});

test("領収書は書式 書式_領収書 に A1:J14 の values だけを書く", () => {
  const result = plan({
    type: "receipt",
    purpose: "システム開発費",
    title: "システム開発業務",
  });
  assert.equal(result.template, "書式_領収書");
  assert.equal(result.name, "領収書_0001_株式会社サンプル商事");
  assert.equal(result.steps.length, 1);
  const step = valuesStepOf(result);
  assert.equal(step.range, "A1:J14");
  assert.equal(step.values.length, 14);
  for (const line of step.values) assert.equal(line.length, 10);

  assert.equal(cell(result, "A1"), "領     収     書");
  assert.equal(cell(result, "A4"), "株式会社サンプル商事　御中");
  assert.equal(cell(result, "I3"), "0001");
  assert.equal(cell(result, "I4"), "2026年11月30日");
  assert.equal(cell(result, "D6"), 66000);
  assert.equal(cell(result, "D7"), "システム開発費として");
  assert.equal(cell(result, "B12"), 60000);
  assert.equal(cell(result, "B13"), 6000);
  assert.equal(cell(result, "F10"), "合同会社サンプル");
  assert.equal(cell(result, "F11"), "〒123-4567　東京都サンプル区1-2-3");
});

test("領収書の但し書きは、purpose が無ければ件名を使う", () => {
  const result = plan({ type: "receipt", title: "コンサルティング費" });
  assert.equal(cell(result, "D7"), "コンサルティング費として");
});

test("領収書の担当者名がある宛先は、担当者名と敬称を並べる", () => {
  const result = plan(
    { type: "receipt" },
    {},
    { contactName: "鈴木 花子", honorific: "様" },
  );
  assert.equal(cell(result, "A4"), "株式会社サンプル商事　鈴木 花子　様");
});

test("単位の無い数量は数値で、単位があれば文字で入る", () => {
  const result = plan(
    makeDoc({
      items: [
        { name: "作業", quantity: 3, unitPrice: 1000, taxRate: 0.1 },
        {
          name: "保守",
          quantity: 1,
          unit: "式",
          unitPrice: 5000,
          taxRate: 0.1,
        },
      ],
    }),
  );
  assert.equal(cell(result, "F17"), 3);
  assert.equal(cell(result, "F18"), "1式");
});

test("備考の行は、行の数に合わせて高くなる", () => {
  const short = plan(makeDoc({ notes: "1 行" }));
  const long = plan(
    makeDoc({ notes: Array.from({ length: 8 }, () => "行").join("\n") }),
  );
  const height = (result: DocumentSheetPlan): number => {
    const step = result.steps.find((s) => s.do === "rowHeight");
    return step && step.do === "rowHeight" ? step.px : 0;
  };
  assert.equal(height(short), 96);
  assert.ok(height(long) > 96);
});
