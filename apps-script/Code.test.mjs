import assert from "node:assert/strict";
import test from "node:test";

import { loadGateway } from "./fake-apps-script.mjs";

const KEY = "test-key";
const WEB_APP_URL = "https://script.google.com/macros/s/AKfycbTEST_id-1/exec";
const EXPENSES = { name: "expenses", header: ["id", "date", "amount"] };

/** 鍵を付けて 1 つの操作を送り、成功を確かめて results[0] を返す。 */
function run(gateway, call) {
  const response = gateway.post({ key: KEY, calls: [call] });
  assert.equal(response.ok, true, JSON.stringify(response));
  return response.results[0];
}

/** 鍵を付けて 1 つの操作を送り、失敗を確かめて error を返す。 */
function runFailing(gateway, call) {
  const response = gateway.post({ key: KEY, calls: [call] });
  assert.equal(response.ok, false, JSON.stringify(response));
  return response.error;
}

/** 見出しだけがある表のタブを持つ窓口。 */
function gatewayWithTable(rows = []) {
  return loadGateway({
    key: KEY,
    sheets: [{ name: EXPENSES.name, rows: [EXPENSES.header, ...rows] }],
  });
}

/** 書式のタブ（先頭 2 行を結合）を持つ窓口。 */
function gatewayWithTemplate() {
  const gateway = loadGateway({
    key: KEY,
    sheets: [
      { name: EXPENSES.name, rows: [EXPENSES.header] },
      { name: "書式", rows: [["請求書"], ["", ""], ["明細"]] },
    ],
  });
  gateway.spreadsheet.sheet("書式").getRange("A1:B2").merge();
  return gateway;
}

function render(gateway, overrides = {}) {
  return run(gateway, {
    op: "renderSheet",
    template: "書式",
    name: "請求書",
    steps: [],
    ...overrides,
  });
}

function gidOf(gateway, name) {
  return gateway.spreadsheet.sheet(name).getSheetId();
}

test("鍵が未発行なら not_configured を返す", () => {
  const gateway = loadGateway();
  const response = gateway.post({ key: "何か", calls: [{ op: "info" }] });
  assert.equal(response.error.code, "not_configured");
});

test("鍵が違えば unauthorized を返し、鍵が無くても同じ", () => {
  const gateway = loadGateway({ key: KEY });
  assert.equal(
    gateway.post({ key: "違う", calls: [{ op: "info" }] }).error.code,
    "unauthorized",
  );
  assert.equal(
    gateway.post({ calls: [{ op: "info" }] }).error.code,
    "unauthorized",
  );
});

test("JSON でない本文と、calls が空の要求は bad_request", () => {
  const gateway = loadGateway({ key: KEY });
  assert.equal(gateway.post("これは JSON ではない").error.code, "bad_request");
  assert.equal(gateway.post({ key: KEY }).error.code, "bad_request");
  assert.equal(gateway.post({ key: KEY, calls: [] }).error.code, "bad_request");
});

test("知らない op は bad_request", () => {
  const gateway = loadGateway({ key: KEY });
  assert.equal(
    runFailing(gateway, { op: "dropEverything" }).code,
    "bad_request",
  );
});

test("Object.prototype のメンバーと同じ名前の op も bad_request", () => {
  const gateway = loadGateway({ key: KEY });
  assert.equal(runFailing(gateway, { op: "toString" }).code, "bad_request");
});

test("本文が JSON の null でも、例外にせず bad_request を返す", () => {
  const gateway = loadGateway({ key: KEY });
  assert.equal(gateway.post("null").error.code, "bad_request");
});

test("doGet は鍵なしで、データを返さずに稼働だけを知らせる", () => {
  const gateway = gatewayWithTable([["a", "2026-11-12", "100"]]);
  const body = gateway.get();
  assert.equal(body.ok, true);
  assert.equal(body.service, "keiri-app");
  assert.deepEqual(Object.keys(body).sort(), ["ok", "service", "v"]);
});

test("info はスプレッドシートの ID・題名・URL・タブを返す", () => {
  const gateway = loadGateway({
    key: KEY,
    spreadsheetId: "sheet-1",
    title: "題名",
    sheets: [{ name: "a" }, { name: "b" }],
  });
  const info = run(gateway, { op: "info" });
  assert.equal(info.spreadsheetId, "sheet-1");
  assert.equal(info.title, "題名");
  assert.equal(info.url, "https://docs.google.com/spreadsheets/d/sheet-1/edit");
  assert.deepEqual(info.tabs, [
    { name: "a", gid: gidOf(gateway, "a") },
    { name: "b", gid: gidOf(gateway, "b") },
  ]);
});

test("ensureTabs は無いタブだけを作って見出しを書き、2 回目は何も作らない", () => {
  const gateway = loadGateway({
    key: KEY,
    sheets: [{ name: "既存", rows: [["そのまま"]] }],
  });
  const tabs = [{ name: "既存", header: ["上書きしない"] }, EXPENSES];

  assert.deepEqual(run(gateway, { op: "ensureTabs", tabs }), {
    created: ["expenses"],
  });
  assert.deepEqual(gateway.spreadsheet.sheetNames(), ["既存", "expenses"]);
  assert.deepEqual(gateway.spreadsheet.sheet("expenses").values, [
    EXPENSES.header,
  ]);
  assert.equal(gateway.spreadsheet.sheet("expenses").frozenRows, 1);
  assert.deepEqual(gateway.spreadsheet.sheet("既存").values, [["そのまま"]]);

  assert.deepEqual(run(gateway, { op: "ensureTabs", tabs }), { created: [] });
  assert.deepEqual(gateway.spreadsheet.sheetNames(), ["既存", "expenses"]);
});

test("read は見出しを含む全行を返し、無いタブは null", () => {
  const gateway = gatewayWithTable([["a", "2026-11-12", "100"]]);
  const tables = run(gateway, { op: "read", tabs: ["expenses", "ない"] });
  assert.deepEqual(tables, {
    expenses: [EXPENSES.header, ["a", "2026-11-12", "100"]],
    ない: null,
  });
});

test("read は空のタブに空配列を返す", () => {
  const gateway = loadGateway({ key: KEY, sheets: [{ name: "empty" }] });
  assert.deepEqual(run(gateway, { op: "read", tabs: ["empty"] }), {
    empty: [],
  });
});

test("append した文字列は、数値や日付や数式に変わらず、そのまま read で返る", () => {
  const gateway = loadGateway({
    key: KEY,
    sheets: [{ name: "t", rows: [["a", "b", "c", "d", "e"]] }],
  });
  const row = ["0022", "2026-11-12", "=1+1", "'abc", ""];

  assert.deepEqual(run(gateway, { op: "append", tab: "t", rows: [row] }), {
    appended: 1,
  });

  const stored = gateway.spreadsheet.sheet("t").values[1];
  assert.deepEqual(stored, ["0022", "2026-11-12", "=1+1", "'abc", ""]);
  assert.equal(typeof stored[0], "string");
  assert.deepEqual(run(gateway, { op: "read", tabs: ["t"] }).t[1], row);
});

test("append は行の長さが揃っていなくても空欄で埋め、続けて末尾に足す", () => {
  const gateway = loadGateway({
    key: KEY,
    sheets: [{ name: "t", rows: [["a", "b"]] }],
  });
  run(gateway, { op: "append", tab: "t", rows: [["1"], ["2", "3"]] });
  run(gateway, { op: "append", tab: "t", rows: [["4", "5"]] });
  assert.deepEqual(gateway.spreadsheet.sheet("t").values, [
    ["a", "b"],
    ["1", ""],
    ["2", "3"],
    ["4", "5"],
  ]);
});

test("append は空の rows なら何も書かず、無いタブなら not_found", () => {
  const gateway = gatewayWithTable();
  assert.deepEqual(run(gateway, { op: "append", tab: "expenses", rows: [] }), {
    appended: 0,
  });
  assert.deepEqual(gateway.spreadsheet.sheet("expenses").values, [
    EXPENSES.header,
  ]);
  assert.equal(
    runFailing(gateway, { op: "append", tab: "ない", rows: [["x"]] }).code,
    "not_found",
  );
});

test("updateById は id が一致する行だけを上書きする", () => {
  const gateway = gatewayWithTable([
    ["a", "2026-11-01", "100"],
    ["b", "2026-11-02", "200"],
    ["c", "2026-11-03", "300"],
  ]);
  run(gateway, {
    op: "updateById",
    tab: "expenses",
    id: "b",
    row: ["b", "2026-11-09", "0900"],
  });
  assert.deepEqual(gateway.spreadsheet.sheet("expenses").values, [
    EXPENSES.header,
    ["a", "2026-11-01", "100"],
    ["b", "2026-11-09", "0900"],
    ["c", "2026-11-03", "300"],
  ]);
});

test("updateById は無い id なら not_found で、何も書き換えない", () => {
  const gateway = gatewayWithTable([["a", "2026-11-01", "100"]]);
  const before = gateway.spreadsheet.sheet("expenses").values;
  assert.equal(
    runFailing(gateway, {
      op: "updateById",
      tab: "expenses",
      id: "zzz",
      row: ["zzz", "", ""],
    }).code,
    "not_found",
  );
  assert.deepEqual(gateway.spreadsheet.sheet("expenses").values, before);
});

test("見出し行の文字と id が同じでも、見出し行は書き換えない", () => {
  const gateway = gatewayWithTable([["a", "2026-11-01", "100"]]);
  assert.equal(
    runFailing(gateway, {
      op: "updateById",
      tab: "expenses",
      id: "id",
      row: ["id", "x", "x"],
    }).code,
    "not_found",
  );
  assert.deepEqual(
    run(gateway, {
      op: "upsertById",
      tab: "expenses",
      id: "id",
      row: ["id", "x", "x"],
    }),
    { created: true },
  );
  assert.deepEqual(
    run(gateway, { op: "deleteById", tab: "expenses", id: "date" }),
    { deleted: false },
  );
  assert.deepEqual(
    gateway.spreadsheet.sheet("expenses").values[0],
    EXPENSES.header,
  );
});

test("upsertById は、あれば上書きし、無ければ末尾に追加する", () => {
  const gateway = gatewayWithTable([["a", "2026-11-01", "100"]]);

  assert.deepEqual(
    run(gateway, {
      op: "upsertById",
      tab: "expenses",
      id: "a",
      row: ["a", "2026-11-05", "150"],
    }),
    { created: false },
  );
  assert.deepEqual(
    run(gateway, {
      op: "upsertById",
      tab: "expenses",
      id: "b",
      row: ["b", "2026-11-06", "250"],
    }),
    { created: true },
  );

  assert.deepEqual(gateway.spreadsheet.sheet("expenses").values, [
    EXPENSES.header,
    ["a", "2026-11-05", "150"],
    ["b", "2026-11-06", "250"],
  ]);
});

test("deleteById は行を消し、無ければ deleted: false", () => {
  const gateway = gatewayWithTable([
    ["a", "2026-11-01", "100"],
    ["b", "2026-11-02", "200"],
  ]);
  assert.deepEqual(
    run(gateway, { op: "deleteById", tab: "expenses", id: "a" }),
    { deleted: true },
  );
  assert.deepEqual(
    run(gateway, { op: "deleteById", tab: "expenses", id: "a" }),
    { deleted: false },
  );
  assert.deepEqual(gateway.spreadsheet.sheet("expenses").values, [
    EXPENSES.header,
    ["b", "2026-11-02", "200"],
  ]);
});

test("nextSeq は、行が無ければ floor + 1、続けて呼ぶと 1 ずつ増える", () => {
  const gateway = loadGateway({
    key: KEY,
    sheets: [{ name: "seq", rows: [["key", "seq"]] }],
  });
  const next = (key, floor) =>
    run(gateway, { op: "nextSeq", tab: "seq", key, floor }).seq;

  assert.equal(next("inv-2026", 0), 1);
  assert.equal(next("inv-2026", 0), 2);
  assert.equal(next("inv-2026", 0), 3);
  assert.equal(next("exp-2026", 10), 11);
  assert.equal(next("exp-2026", 0), 12);
  assert.deepEqual(gateway.spreadsheet.sheet("seq").values, [
    ["key", "seq"],
    ["inv-2026", "3"],
    ["exp-2026", "12"],
  ]);
});

test("nextSeq は、保存値より floor が大きければ floor を基準にする", () => {
  const gateway = loadGateway({
    key: KEY,
    sheets: [
      {
        name: "seq",
        rows: [
          ["key", "seq"],
          ["k", "5"],
        ],
      },
    ],
  });
  assert.equal(
    run(gateway, { op: "nextSeq", tab: "seq", key: "k", floor: 100 }).seq,
    101,
  );
  assert.equal(
    run(gateway, { op: "nextSeq", tab: "seq", key: "k", floor: 3 }).seq,
    102,
  );
});

test("nextSeq は 1 回の要求の中で続けて呼んでも 1 ずつ増える", () => {
  const gateway = loadGateway({
    key: KEY,
    sheets: [{ name: "seq", rows: [["key", "seq"]] }],
  });
  const call = { op: "nextSeq", tab: "seq", key: "k", floor: 0 };
  const response = gateway.post({ key: KEY, calls: [call, call, call] });
  assert.deepEqual(response.results, [{ seq: 1 }, { seq: 2 }, { seq: 3 }]);
});

test("renderSheet は書式のタブを複製して名前を付け、書式のタブは変えない", () => {
  const gateway = gatewayWithTemplate();
  const result = render(gateway);

  assert.equal(result.name, "請求書");
  assert.equal(result.gid, String(gidOf(gateway, "請求書")));
  assert.deepEqual(gateway.spreadsheet.sheetNames(), [
    "expenses",
    "書式",
    "請求書",
  ]);
  assert.deepEqual(
    gateway.spreadsheet.sheet("請求書").values,
    gateway.spreadsheet.sheet("書式").values,
  );
  assert.deepEqual(gateway.spreadsheet.sheet("請求書").mergedA1, ["A1:B2"]);
});

test("renderSheet の save は、作ったタブの gid と URL を入れた行を保存する", () => {
  const gateway = gatewayWithTemplate();
  const save = {
    tab: "expenses",
    id: "doc-1",
    row: ["doc-1", "", ""],
    fill: { 1: "gid", 2: "url" },
  };

  const first = render(gateway, { save });
  assert.deepEqual(gateway.spreadsheet.sheet("expenses").values, [
    EXPENSES.header,
    ["doc-1", first.gid, first.url],
  ]);
  assert.match(first.url, /\/edit#gid=\d+$/);

  const second = render(gateway, { save, replaceGid: first.gid });
  assert.notEqual(second.gid, first.gid);
  assert.deepEqual(gateway.spreadsheet.sheet("expenses").values, [
    EXPENSES.header,
    ["doc-1", second.gid, second.url],
  ]);
  assert.deepEqual(gateway.spreadsheet.sheetNames(), [
    "expenses",
    "書式",
    "請求書",
  ]);
});

test("renderSheet は steps を順に実行する", () => {
  const gateway = gatewayWithTemplate();
  const { name } = render(gateway, {
    steps: [
      { do: "unmerge", range: "A1:B1" },
      { do: "insertRowsAfter", row: 2, count: 2 },
      { do: "values", range: "A3:B3", values: [["0022", 1200]] },
      { do: "merge", range: "A4:B4" },
      { do: "showRows", from: 1, count: 2 },
      { do: "hideRows", from: 3, count: 2 },
      { do: "rowHeight", row: 1, px: 40 },
      {
        do: "format",
        range: "A1:B1",
        wrap: true,
        vertical: "top",
        horizontal: "center",
      },
      { do: "borderBottom", range: "A4:B4" },
    ],
  });
  const sheet = gateway.spreadsheet.sheet(name);

  assert.deepEqual(sheet.mergedA1, ["A4:B4"]);
  assert.deepEqual(sheet.values, [
    ["請求書", ""],
    ["", ""],
    ["0022", 1200],
    ["", ""],
    ["明細", ""],
  ]);
  assert.equal(sheet.rowState(3).hidden, true);
  assert.equal(sheet.rowState(1).hidden, false);
  assert.equal(sheet.rowState(1).height, 40);
  assert.deepEqual(
    sheet.calls.filter((c) =>
      [
        "setWrapStrategy",
        "setVerticalAlignment",
        "setHorizontalAlignment",
        "setBorder",
      ].includes(c.method),
    ),
    [
      { method: "setWrapStrategy", range: "A1:B1", args: ["WRAP"] },
      { method: "setVerticalAlignment", range: "A1:B1", args: ["top"] },
      { method: "setHorizontalAlignment", range: "A1:B1", args: ["center"] },
      {
        method: "setBorder",
        range: "A4:B4",
        args: [null, null, true, null, null, null, "#000000", "SOLID"],
      },
    ],
  );
  assert.deepEqual(gateway.spreadsheet.sheet("書式").mergedA1, ["A1:B2"]);
  assert.deepEqual(gateway.spreadsheet.sheet("書式").values, [
    ["請求書"],
    [""],
    ["明細"],
  ]);
});

test("renderSheet は同じ名前があれば (2) を付ける", () => {
  const gateway = gatewayWithTemplate();
  assert.equal(render(gateway).name, "請求書");
  assert.equal(render(gateway).name, "請求書 (2)");
  assert.equal(render(gateway).name, "請求書 (3)");
});

test("renderSheet に前回の gid を渡すと、前のタブが消えて同じ名前を使う", () => {
  const gateway = gatewayWithTemplate();
  const first = render(gateway);
  const second = render(gateway, { replaceGid: first.gid });

  assert.equal(second.name, "請求書");
  assert.notEqual(second.gid, first.gid);
  assert.deepEqual(gateway.spreadsheet.sheetNames(), [
    "expenses",
    "書式",
    "請求書",
  ]);
});

test("renderSheet は書式のタブが無ければ not_found", () => {
  const gateway = gatewayWithTemplate();
  assert.equal(
    runFailing(gateway, {
      op: "renderSheet",
      template: "ない",
      name: "x",
      steps: [],
    }).code,
    "not_found",
  );
});

test("renderSheet は知らない手順なら bad_request", () => {
  const gateway = gatewayWithTemplate();
  assert.equal(
    runFailing(gateway, {
      op: "renderSheet",
      template: "書式",
      name: "x",
      steps: [{ do: "explode" }],
    }).code,
    "bad_request",
  );
});

test("renderSheet は知らない手順なら、タブを作る前に断る", () => {
  const gateway = gatewayWithTemplate();
  runFailing(gateway, {
    op: "renderSheet",
    template: "書式",
    name: "x",
    steps: [{ do: "explode" }],
  });
  assert.deepEqual(gateway.spreadsheet.sheetNames(), ["expenses", "書式"]);
});

test("deleteSheet は renderSheet で作ったタブを消す", () => {
  const gateway = gatewayWithTemplate();
  const { gid } = render(gateway);
  assert.deepEqual(run(gateway, { op: "deleteSheet", gid }), { deleted: true });
  assert.deepEqual(gateway.spreadsheet.sheetNames(), ["expenses", "書式"]);
  assert.deepEqual(run(gateway, { op: "deleteSheet", gid }), {
    deleted: false,
  });
});

test("deleteSheet は表のタブも書式のタブも、gid を渡されて消さない", () => {
  const gateway = gatewayWithTemplate();
  for (const name of ["expenses", "書式"]) {
    assert.deepEqual(
      run(gateway, { op: "deleteSheet", gid: gidOf(gateway, name) }),
      { deleted: false },
    );
    assert.deepEqual(
      run(gateway, { op: "deleteSheet", gid: String(gidOf(gateway, name)) }),
      { deleted: false },
    );
  }
  assert.deepEqual(run(gateway, { op: "deleteSheet", gid: 9999 }), {
    deleted: false,
  });
  assert.deepEqual(gateway.spreadsheet.sheetNames(), ["expenses", "書式"]);
});

test("exportPdf は base64 を返し、format・gid の上書きと、決めていない項目を無視する", () => {
  const gateway = gatewayWithTemplate();
  const { gid } = render(gateway);
  const { base64 } = run(gateway, {
    op: "exportPdf",
    gid: String(gid),
    params: {
      format: "xlsx",
      gid: "9999",
      size: "A4",
      portrait: "true",
      Bad_Key: "x",
      "bad-key": "x",
      title: "日 本",
    },
  });

  const query = `format=pdf&gid=${gid}&size=A4&portrait=true`;
  assert.equal(
    Buffer.from(base64, "base64").toString("utf8"),
    `%PDF-fake:${query}`,
  );
  assert.equal(gateway.fetches.length, 1);
  assert.equal(
    gateway.fetches[0].url,
    `https://docs.google.com/spreadsheets/d/fake-spreadsheet-id/export?${query}`,
  );
  assert.equal(
    gateway.fetches[0].params.headers.Authorization,
    "Bearer fake-oauth-token",
  );
});

test("exportPdf は gid が無ければ not_found、書き出しが失敗すれば internal", () => {
  const gateway = loadGateway({
    key: KEY,
    sheets: [{ name: "t" }],
    fetch: () => ({ status: 500 }),
  });
  assert.equal(
    runFailing(gateway, { op: "exportPdf", gid: 9999, params: {} }).code,
    "not_found",
  );
  const error = runFailing(gateway, {
    op: "exportPdf",
    gid: gidOf(gateway, "t"),
    params: {},
  });
  assert.equal(error.code, "internal");
  assert.match(error.message, /500/);
});

test("書き込みを含む要求でロックが取れなければ busy を返し、何も書かない", () => {
  const gateway = gatewayWithTable();
  gateway.locks.busy = true;

  assert.equal(
    runFailing(gateway, {
      op: "append",
      tab: "expenses",
      rows: [["a", "", ""]],
    }).code,
    "busy",
  );
  assert.deepEqual(gateway.spreadsheet.sheet("expenses").values, [
    EXPENSES.header,
  ]);
  assert.equal(gateway.locks.releaseCalls, 0);

  const mixed = gateway.post({
    key: KEY,
    calls: [
      { op: "read", tabs: ["expenses"] },
      { op: "deleteById", tab: "expenses", id: "a" },
    ],
  });
  assert.equal(mixed.error.code, "busy");
});

test("読み取りだけの要求はロックを取らず、書き込みはロックを取って必ず手放す", () => {
  const gateway = gatewayWithTable();
  gateway.locks.busy = true;
  for (const call of [{ op: "info" }, { op: "read", tabs: ["expenses"] }])
    run(gateway, call);
  assert.equal(gateway.locks.tryLockCalls, 0);

  gateway.locks.busy = false;
  run(gateway, { op: "append", tab: "expenses", rows: [["a", "", ""]] });
  runFailing(gateway, {
    op: "updateById",
    tab: "expenses",
    id: "zzz",
    row: ["zzz"],
  });
  assert.equal(gateway.locks.tryLockCalls, 2);
  assert.equal(gateway.locks.releaseCalls, 2);
});

test("issueConnectionCode は URL の形が違えば例外にする", () => {
  const gateway = loadGateway();
  for (const url of [
    "",
    null,
    "http://script.google.com/macros/s/AKfycbTEST/exec",
    "https://script.google.com/macros/s/AKfycbTEST/dev",
    `${WEB_APP_URL}?x=1`,
    "https://example.com/macros/s/AKfycbTEST/exec",
  ]) {
    assert.throws(
      () => gateway.context.issueConnectionCode(url, false),
      /URL の形が違います/,
    );
  }
  assert.equal(gateway.fetches.length, 0);
  assert.equal(gateway.properties.getProperty("KEIRI_KEY"), null);
});

test("issueConnectionCode は keiri1_ で始まるコードを返し、戻すと URL と鍵が読める", () => {
  const gateway = loadGateway();
  const code = gateway.context.issueConnectionCode(` ${WEB_APP_URL} `, false);

  assert.match(code, /^keiri1_[\w-]+$/);
  const payload = JSON.parse(
    Buffer.from(code.slice("keiri1_".length), "base64url").toString("utf8"),
  );
  assert.deepEqual(Object.keys(payload).sort(), ["k", "s", "u"]);
  assert.equal(payload.u, WEB_APP_URL);
  assert.equal(payload.s, gateway.spreadsheet.getId());
  assert.match(payload.k, /^[0-9a-f]{64}$/);
  assert.equal(
    gateway.properties.getProperty("KEIRI_KEY"),
    `${gateway.spreadsheet.getId()}:${payload.k}`,
  );

  assert.equal(gateway.fetches.length, 1);
  assert.equal(gateway.fetches[0].url, WEB_APP_URL);
  assert.deepEqual(JSON.parse(gateway.fetches[0].params.payload), {
    key: payload.k,
    calls: [{ op: "info" }],
  });
});

test("issueConnectionCode の鍵で、アプリから要求が通る", () => {
  const gateway = loadGateway({ sheets: [{ name: "t" }] });
  const code = gateway.context.issueConnectionCode(WEB_APP_URL, false);
  const { k } = JSON.parse(
    Buffer.from(code.slice("keiri1_".length), "base64url").toString("utf8"),
  );
  assert.equal(gateway.post({ key: k, calls: [{ op: "info" }] }).ok, true);
});

test("issueConnectionCode は 2 回目に同じ鍵を返し、rotate が true なら鍵を変える", () => {
  const gateway = loadGateway();
  const keyOf = (code) =>
    JSON.parse(
      Buffer.from(code.slice("keiri1_".length), "base64url").toString("utf8"),
    ).k;

  const first = keyOf(gateway.context.issueConnectionCode(WEB_APP_URL, false));
  assert.equal(
    keyOf(gateway.context.issueConnectionCode(WEB_APP_URL, false)),
    first,
  );

  const rotated = keyOf(gateway.context.issueConnectionCode(WEB_APP_URL, true));
  assert.notEqual(rotated, first);
  assert.equal(
    gateway.properties.getProperty("KEIRI_KEY"),
    `${gateway.spreadsheet.getId()}:${rotated}`,
  );
  assert.equal(
    gateway.post({ key: first, calls: [{ op: "info" }] }).error.code,
    "unauthorized",
  );
  assert.equal(
    gateway.post({ key: rotated, calls: [{ op: "info" }] }).ok,
    true,
  );
});

test("issueConnectionCode は既に鍵がある窓口では、その鍵をコードに入れる", () => {
  const gateway = loadGateway({ key: KEY });
  const code = gateway.context.issueConnectionCode(WEB_APP_URL, false);
  assert.equal(
    JSON.parse(
      Buffer.from(code.slice("keiri1_".length), "base64url").toString("utf8"),
    ).k,
    KEY,
  );
});

test("issueConnectionCode は、ウェブアプリが HTML を返したらデプロイ設定を直すよう促す", () => {
  const gateway = loadGateway({
    fetch: () => ({ text: "<html><body>ログインしてください</body></html>" }),
  });
  assert.throws(
    () => gateway.context.issueConnectionCode(WEB_APP_URL, false),
    /デプロイの設定.*アクセスできるユーザー/,
  );
});

test("issueConnectionCode は、ウェブアプリが失敗を返した場合も同じ例外にする", () => {
  const gateway = loadGateway({
    fetch: () => ({
      text: JSON.stringify({ ok: false, error: { code: "unauthorized" } }),
    }),
  });
  assert.throws(
    () => gateway.context.issueConnectionCode(WEB_APP_URL, false),
    /デプロイの設定/,
  );
});

test("issueConnectionCode は、別のスプレッドシートの URL なら例外にする", () => {
  const gateway = loadGateway({
    spreadsheetId: "this-sheet",
    fetch: () => ({
      text: JSON.stringify({
        ok: true,
        v: 1,
        results: [{ spreadsheetId: "other-sheet" }],
      }),
    }),
  });
  assert.throws(
    () => gateway.context.issueConnectionCode(WEB_APP_URL, false),
    /別のスプレッドシート/,
  );
});

test("onOpen はメニューを作り、ダイアログを開く関数がメニューの項目から呼べる", () => {
  const gateway = loadGateway();
  gateway.context.onOpen();
  assert.equal(gateway.ui.menus.length, 1);
  assert.equal(gateway.ui.menus[0].title, "keiri-app");
  for (const { functionName } of gateway.ui.menus[0].items)
    gateway.context[functionName]();
  assert.deepEqual(
    gateway.ui.dialogs.map(({ file, rotate }) => ({ file, rotate })),
    [
      { file: "Dialog", rotate: false },
      { file: "Dialog", rotate: true },
    ],
  );
});

test("偽物の確認: setValues は利用者の入力と同じ解釈をする", () => {
  const gateway = loadGateway({ sheets: [{ name: "t" }] });
  const sheet = gateway.spreadsheet.sheet("t");
  sheet
    .getRange(1, 1, 1, 7)
    .setValues([["'0022", "'=1+1", "''a", "0022", "1200", 1200, "abc"]]);

  assert.deepEqual(sheet.values, [
    ["0022", "=1+1", "'a", 22, 1200, 1200, "abc"],
  ]);
  assert.deepEqual(sheet.getRange("A1:G1").getDisplayValues(), [
    ["0022", "=1+1", "'a", "22", "1200", "1200", "abc"],
  ]);
});

test("偽物の確認: 範囲と値の大きさが合わない setValues と、足りないメソッドは例外になる", () => {
  const gateway = loadGateway({ sheets: [{ name: "t" }] });
  const sheet = gateway.spreadsheet.sheet("t");
  assert.throws(
    () => sheet.getRange(1, 1, 1, 2).setValues([["a"]]),
    /大きさが範囲と合いません/,
  );
  assert.throws(
    () => sheet.autoResizeColumns(1),
    /Sheet\.autoResizeColumns がありません/,
  );
});

test("別のスプレッドシートからコピーされた鍵は使えない", () => {
  const gateway = loadGateway({
    key: KEY,
    keyFromSpreadsheet: "original-spreadsheet-id",
  });
  const response = gateway.post({ key: KEY, calls: [{ op: "info" }] });
  assert.equal(response.ok, false);
  assert.equal(response.error.code, "not_configured");
});

test("コピーされた鍵があっても、接続コードの発行で新しい鍵になる", () => {
  const gateway = loadGateway({
    key: KEY,
    keyFromSpreadsheet: "original-spreadsheet-id",
  });
  const code = gateway.context.issueConnectionCode(WEB_APP_URL, false);
  const { k } = JSON.parse(
    Buffer.from(code.slice("keiri1_".length), "base64url").toString("utf8"),
  );
  assert.notEqual(k, KEY);
  assert.equal(gateway.post({ key: k, calls: [{ op: "info" }] }).ok, true);
});

test("作り直しで届かなかったときは、今までの鍵に戻す", () => {
  const gateway = loadGateway({
    key: KEY,
    fetch: () => ({
      getContentText: () => "<html>ログインが必要です</html>",
      getResponseCode: () => 200,
    }),
  });
  assert.throws(
    () => gateway.context.issueConnectionCode(WEB_APP_URL, true),
    /届きませんでした/,
  );
  assert.equal(gateway.post({ key: KEY, calls: [{ op: "info" }] }).ok, true);
});

test("renderSheet の values は、= で始まる文字を数式ではなく文字として書く", () => {
  const gateway = gatewayWithTemplate();
  const result = render(gateway, {
    steps: [
      {
        do: "values",
        range: "A1:C1",
        values: [['=TEXTJOIN(",",TRUE,users!A1:F20)', "0022", 1200]],
      },
    ],
  });
  const tab = gateway.spreadsheet
    .getSheets()
    .find((sheet) => String(sheet.getSheetId()) === result.gid);
  assert.deepEqual(tab.getRange("A1:C1").getDisplayValues(), [
    ['=TEXTJOIN(",",TRUE,users!A1:F20)', "0022", "1200"],
  ]);
});

test("書式のタブは、表として読み書きできない", () => {
  const templated = loadGateway({
    key: KEY,
    sheets: [{ name: "書式_請求書", rows: [["請求書"]] }],
  });
  assert.equal(
    runFailing(templated, { op: "append", tab: "書式_請求書", rows: [["x"]] })
      .code,
    "bad_request",
  );
  assert.deepEqual(run(templated, { op: "read", tabs: ["書式_請求書"] }), {
    書式_請求書: null,
  });
});

test("exportPdf は、決めた項目以外の指定を URL に入れない", () => {
  const gateway = gatewayWithTemplate();
  const { gid } = render(gateway);
  const { base64 } = run(gateway, {
    op: "exportPdf",
    gid,
    params: { size: "7", range: "users!A1:F20", id: "other" },
  });
  const query = Buffer.from(base64, "base64").toString("utf8");
  assert.match(query, /size=7/);
  assert.doesNotMatch(query, /range=|[?&]id=/);
});

test("renderSheet は手順の途中で失敗したら、作りかけのタブを消し、前のタブと行を残す", () => {
  const gateway = gatewayWithTemplate();
  const save = {
    tab: "expenses",
    id: "doc-1",
    row: ["doc-1", "", ""],
    fill: { 1: "gid" },
  };
  const first = render(gateway, { save });

  const error = runFailing(gateway, {
    op: "renderSheet",
    template: "書式",
    name: "請求書",
    replaceGid: first.gid,
    steps: [{ do: "values", range: "A1:B1", values: [["大きさが合わない"]] }],
    save,
  });
  assert.equal(error.code, "internal");
  assert.deepEqual(gateway.spreadsheet.sheetNames(), [
    "expenses",
    "書式",
    "請求書",
  ]);
  assert.equal(gidOf(gateway, "請求書"), Number(first.gid));
  assert.deepEqual(gateway.spreadsheet.sheet("expenses").values[1], [
    "doc-1",
    first.gid,
    "",
  ]);
});

test("renderSheet の作り直しでは、前のタブを消してから、同じ名前に付け直す", () => {
  const gateway = gatewayWithTemplate();
  const first = render(gateway);
  const second = render(gateway, { replaceGid: first.gid });
  assert.equal(second.name, "請求書");
  assert.deepEqual(gateway.spreadsheet.sheetNames(), [
    "expenses",
    "書式",
    "請求書",
  ]);
});

test("印の無い古い帳票のタブは、名前が一致したときだけ消す", () => {
  const gateway = loadGateway({
    key: KEY,
    sheets: [
      { name: "expenses", rows: [EXPENSES.header] },
      { name: "書式", rows: [["請求書"]] },
      { name: "請求書_0001_株式会社サンプル商事", rows: [["古い請求書"]] },
      { name: "自分のメモ", rows: [["メモ"]] },
    ],
  });
  const legacy = gidOf(gateway, "請求書_0001_株式会社サンプル商事");
  const memo = gidOf(gateway, "自分のメモ");

  assert.deepEqual(
    run(gateway, { op: "deleteSheet", gid: String(legacy), name: "違う名前" }),
    { deleted: false },
  );
  assert.deepEqual(
    run(gateway, { op: "deleteSheet", gid: String(memo), name: "自分のメモ" }),
    { deleted: false },
  );
  assert.deepEqual(
    run(gateway, {
      op: "deleteSheet",
      gid: String(legacy),
      name: "請求書_0001_株式会社サンプル商事",
    }),
    { deleted: true },
  );
  assert.deepEqual(gateway.spreadsheet.sheetNames(), [
    "expenses",
    "書式",
    "自分のメモ",
  ]);
});

test("append は、右の列だけに値がある行の下ではなく、表の続きに足す", () => {
  const gateway = gatewayWithTable([["e1", "2026-01-01", "100"]]);
  gateway.spreadsheet
    .sheet("expenses")
    .getRange("Z20")
    .setValues([["メモ"]]);
  run(gateway, {
    op: "append",
    tab: "expenses",
    rows: [["e2", "2026-01-02", "200"]],
  });
  const values = gateway.spreadsheet.sheet("expenses").values;
  assert.deepEqual(values[2].slice(0, 3), ["e2", "2026-01-02", "200"]);
  const [table] = Object.values(
    run(gateway, { op: "read", tabs: ["expenses"] }),
  );
  assert.equal(table.length, 20);
});

test("renderSheet は行の保存に失敗したら、作りかけのタブを消し、前のタブを残す", () => {
  const gateway = gatewayWithTemplate();
  const first = render(gateway);
  const error = runFailing(gateway, {
    op: "renderSheet",
    template: "書式",
    name: "請求書",
    replaceGid: first.gid,
    steps: [],
    save: { tab: "無いタブ", id: "doc-1", row: ["doc-1"], fill: {} },
  });
  assert.equal(error.code, "not_found");
  assert.deepEqual(gateway.spreadsheet.sheetNames(), [
    "expenses",
    "書式",
    "請求書",
  ]);
  assert.equal(gidOf(gateway, "請求書"), Number(first.gid));
});

test("renderSheet の作り直しでは、付け直した名前で行を保存する", () => {
  const gateway = gatewayWithTemplate();
  const save = {
    tab: "expenses",
    id: "doc-1",
    row: ["doc-1", "", ""],
    fill: { 1: "gid", 2: "name" },
  };
  const first = render(gateway, { save });
  const second = render(gateway, { save, replaceGid: first.gid });
  assert.equal(second.name, "請求書");
  assert.deepEqual(gateway.spreadsheet.sheet("expenses").values[1], [
    "doc-1",
    second.gid,
    "請求書",
  ]);
});
