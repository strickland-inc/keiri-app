import { randomUUID } from "node:crypto";
import fs from "node:fs";
import vm from "node:vm";

/**
 * Code.gs を Node の vm で動かすための、偽の Apps Script 環境。
 * Code.gs が使う範囲だけを再現する。足りないメソッドが呼ばれたら、どれが足りないかを書いた例外にする。
 *
 * @typedef {object} FetchResult UrlFetchApp.fetch の応答。options.fetch が返す。
 * @property {number} [status] HTTP の状態コード。省略すると 200
 * @property {string} [text] 本文の文字列
 * @property {ArrayLike<number>} [bytes] 本文のバイト列。text を省略すると、これを UTF-8 として読んだ文字列を本文にする
 *
 * @typedef {object} LoadOptions
 * @property {string} [spreadsheetId]
 * @property {string} [keyFromSpreadsheet] 鍵を保存したスプレッドシートの ID（コピーの再現用）
 * @property {string} [title]
 * @property {Array<{ name: string, rows?: Array<Array<string | number>> }>} [sheets] 保存済みの状態として、そのまま置く（先頭の ' などの解釈はしない）
 * @property {string} [key] Script Properties の KEIRI_KEY に入れる鍵
 * @property {boolean} [lockBusy] true なら tryLock が false を返す。戻り値の locks.busy で後から切り替えられる
 * @property {(url: string, params: object) => FetchResult | undefined} [fetch] UrlFetchApp.fetch の差し替え。undefined を返すと既定の動きにする
 */

const GATEWAY_SOURCE = fs.readFileSync(
  new URL("./Code.gs", import.meta.url),
  "utf8",
);
const WEB_APP_URL = /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/;
const EXPORT_URL =
  /^https:\/\/docs\.google\.com\/spreadsheets\/d\/([^/]+)\/export\?(.*)$/;
const NUMBER_TEXT = /^\s*[+-]?(\d+(\.\d*)?|\.\d+)\s*$/;
const PASSTHROUGH_NAMES = new Set(["then", "toJSON"]);

/** 無いメンバーを読んだとき、undefined を返さず、何が足りないかを書いて落とす。 */
function strict(label, target) {
  return new Proxy(target, {
    get(object, name, receiver) {
      if (
        name in object ||
        typeof name === "symbol" ||
        PASSTHROUGH_NAMES.has(name)
      ) {
        return Reflect.get(object, name, receiver);
      }
      throw new Error(
        `偽の Apps Script に ${label}.${name} がありません。必要なら fake-apps-script.mjs に足してください`,
      );
    },
  });
}

function columnName(number) {
  let name = "";
  for (let rest = number; rest > 0; rest = Math.floor((rest - 1) / 26)) {
    name = String.fromCharCode(65 + ((rest - 1) % 26)) + name;
  }
  return name;
}

function columnNumber(letters) {
  return [...letters].reduce(
    (number, letter) => number * 26 + letter.charCodeAt(0) - 64,
    0,
  );
}

function parseA1(a1) {
  const match = /^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/.exec(a1);
  if (!match) throw new Error(`A1 表記を読めません: ${a1}`);
  const col1 = columnNumber(match[1]);
  const row1 = Number(match[2]);
  const col2 = match[3] ? columnNumber(match[3]) : col1;
  const row2 = match[4] ? Number(match[4]) : row1;
  return {
    row: Math.min(row1, row2),
    col: Math.min(col1, col2),
    numRows: Math.abs(row2 - row1) + 1,
    numCols: Math.abs(col2 - col1) + 1,
  };
}

function toA1({ row, col, numRows, numCols }) {
  const start = columnName(col) + row;
  if (numRows === 1 && numCols === 1) return start;
  return `${start}:${columnName(col + numCols - 1)}${row + numRows - 1}`;
}

function overlaps(a, b) {
  return (
    a.row <= b.row + b.numRows - 1 &&
    b.row <= a.row + a.numRows - 1 &&
    a.col <= b.col + b.numCols - 1 &&
    b.col <= a.col + a.numCols - 1
  );
}

/**
 * 利用者がセルに入力したときと同じ解釈をする。
 * 先頭が ' なら、その 1 文字を除いた残りを文字列のまま保存する。数値に見える文字列は数値にする。
 * 日付や数式の解釈は再現しない。
 */
function interpretInput(value) {
  if (value == null) return "";
  if (typeof value !== "string") return value;
  if (value.startsWith("'")) return value.slice(1);
  if (NUMBER_TEXT.test(value)) return Number(value);
  return value;
}

class FakeRange {
  constructor(sheet, area) {
    this._sheet = sheet;
    this._area = area;
  }

  getDisplayValues() {
    const { row, col, numRows, numCols } = this._area;
    return Array.from({ length: numRows }, (_, r) =>
      Array.from({ length: numCols }, (_, c) =>
        String(this._sheet._get(row + r, col + c)),
      ),
    );
  }

  getDisplayValue() {
    return String(this._sheet._get(this._area.row, this._area.col));
  }

  setValues(values) {
    const { row, col, numRows, numCols } = this._area;
    if (
      values.length !== numRows ||
      values.some((line) => line.length !== numCols)
    ) {
      throw new Error(
        `setValues の大きさが範囲と合いません: 範囲は ${numRows} 行 ${numCols} 列 (${toA1(this._area)})`,
      );
    }
    values.forEach((line, r) => {
      line.forEach((value, c) =>
        this._sheet._set(row + r, col + c, interpretInput(value)),
      );
    });
    return this;
  }

  getMergedRanges() {
    return this._sheet._merges
      .filter((merge) => overlaps(merge, this._area))
      .map((merge) => new FakeRange(this._sheet, { ...merge }));
  }

  breakApart() {
    this._sheet._merges = this._sheet._merges.filter(
      (merge) => !overlaps(merge, this._area),
    );
    return this;
  }

  merge() {
    this._sheet._merges = this._sheet._merges.filter(
      (merge) => !overlaps(merge, this._area),
    );
    this._sheet._merges.push({ ...this._area });
    return this;
  }

  setWrapStrategy(strategy) {
    return this._record("setWrapStrategy", strategy);
  }

  setVerticalAlignment(alignment) {
    return this._record("setVerticalAlignment", alignment);
  }

  setHorizontalAlignment(alignment) {
    return this._record("setHorizontalAlignment", alignment);
  }

  setBorder(...args) {
    return this._record("setBorder", ...args);
  }

  _record(method, ...args) {
    this._sheet.calls.push({ method, range: toA1(this._area), args });
    return this;
  }
}

class FakeSheet {
  constructor(spreadsheet, name, id) {
    this._spreadsheet = spreadsheet;
    this._name = name;
    this._id = id;
    this._cells = [];
    this._merges = [];
    this._rowStates = new Map();
    this._metadata = [];
    this.frozenRows = 0;
    /** setFrozenRows などの「記録するだけ」の呼び出し。{ method, args } で、Range の呼び出しは range（A1 表記）も持つ */
    this.calls = [];
  }

  getName() {
    return this._name;
  }

  setName(name) {
    this._spreadsheet._checkFreeName(name);
    this._name = name;
    return this;
  }

  getSheetId() {
    return this._id;
  }

  getLastRow() {
    let last = 0;
    this._cells.forEach((line, index) => {
      if (line.some((value) => value !== "" && value !== undefined))
        last = index + 1;
    });
    return last;
  }

  getLastColumn() {
    let last = 0;
    this._cells.forEach((line) => {
      line.forEach((value, index) => {
        if (value !== "" && value !== undefined)
          last = Math.max(last, index + 1);
      });
    });
    return last;
  }

  getRange(first, col, numRows = 1, numCols = 1) {
    if (typeof first === "string") return new FakeRange(this, parseA1(first));
    if (
      ![first, col, numRows, numCols].every(
        (n) => Number.isInteger(n) && n >= 1,
      )
    ) {
      throw new Error(
        `getRange の引数が正しくありません: ${[first, col, numRows, numCols].join(", ")}`,
      );
    }
    return new FakeRange(this, { row: first, col, numRows, numCols });
  }

  deleteRow(row) {
    this._cells.splice(row - 1, 1);
    this._merges = this._merges.flatMap((merge) => {
      const end = merge.row + merge.numRows - 1;
      if (end < row) return [merge];
      if (merge.row > row) return [{ ...merge, row: merge.row - 1 }];
      return merge.numRows === 1
        ? []
        : [{ ...merge, numRows: merge.numRows - 1 }];
    });
    this._rowStates = new Map(
      [...this._rowStates].flatMap(([r, state]) =>
        r === row ? [] : [[r > row ? r - 1 : r, state]],
      ),
    );
    return this;
  }

  insertRowsAfter(row, count) {
    while (this._cells.length < row) this._cells.push([]);
    this._cells.splice(row, 0, ...Array.from({ length: count }, () => []));
    this._merges = this._merges.map((merge) => {
      if (merge.row > row) return { ...merge, row: merge.row + count };
      if (merge.row + merge.numRows - 1 > row)
        return { ...merge, numRows: merge.numRows + count };
      return merge;
    });
    this._rowStates = new Map(
      [...this._rowStates].map(([r, state]) => [
        r > row ? r + count : r,
        state,
      ]),
    );
    return this;
  }

  setFrozenRows(count) {
    this.frozenRows = count;
    this.calls.push({ method: "setFrozenRows", args: [count] });
  }

  showRows(from, count = 1) {
    this._eachRow(from, count, (state) => (state.hidden = false));
    this.calls.push({ method: "showRows", args: [from, count] });
  }

  hideRows(from, count = 1) {
    this._eachRow(from, count, (state) => (state.hidden = true));
    this.calls.push({ method: "hideRows", args: [from, count] });
  }

  setRowHeight(row, px) {
    this._eachRow(row, 1, (state) => (state.height = px));
    this.calls.push({ method: "setRowHeight", args: [row, px] });
    return this;
  }

  /** 値・結合・行の状態を複製し、「<元の名前> のコピー」で末尾に足す。開発者メタデータは複製しない。 */
  copyTo(spreadsheet) {
    const copy = spreadsheet._addSheet(`${this._name} のコピー`);
    copy._cells = this._cells.map((line) => [...line]);
    copy._merges = this._merges.map((merge) => ({ ...merge }));
    copy._rowStates = new Map(
      [...this._rowStates].map(([row, state]) => [row, { ...state }]),
    );
    copy.frozenRows = this.frozenRows;
    return copy;
  }

  addDeveloperMetadata(key, value) {
    this._metadata.push(
      strict("DeveloperMetadata", {
        getKey: () => key,
        getValue: () => value,
      }),
    );
    return this;
  }

  getDeveloperMetadata() {
    return [...this._metadata];
  }

  /** テスト用。保存されている値（数値は数値のまま）を、値のある範囲の 2 次元配列で返す。 */
  get values() {
    return this._grid((value) => value);
  }

  /** テスト用。getDisplayValues と同じ、すべて文字列の 2 次元配列。 */
  get displayValues() {
    return this._grid((value) => String(value));
  }

  /** テスト用。結合されている範囲を A1 表記で返す。 */
  get mergedA1() {
    return this._merges.map(toA1);
  }

  /** テスト用。行の表示状態と高さ。 */
  rowState(row) {
    const state = this._rowStates.get(row);
    return { hidden: state?.hidden ?? false, height: state?.height };
  }

  _grid(convert) {
    const rows = this.getLastRow();
    const cols = this.getLastColumn();
    return Array.from({ length: rows }, (_, r) =>
      Array.from({ length: cols }, (_, c) => convert(this._get(r + 1, c + 1))),
    );
  }

  _get(row, col) {
    const value = this._cells[row - 1]?.[col - 1];
    return value === undefined ? "" : value;
  }

  _set(row, col, value) {
    while (this._cells.length < row) this._cells.push([]);
    const line = this._cells[row - 1];
    while (line.length < col - 1) line.push("");
    line[col - 1] = value;
  }

  _eachRow(from, count, update) {
    for (let row = from; row < from + count; row++) {
      const state = this._rowStates.get(row) ?? {};
      update(state);
      this._rowStates.set(row, state);
    }
  }
}

class FakeSpreadsheet {
  constructor({ id, title }) {
    this._id = id;
    this._title = title;
    this._sheets = [];
    this._nextSheetId = 0;
  }

  getId() {
    return this._id;
  }

  getName() {
    return this._title;
  }

  getUrl() {
    return `https://docs.google.com/spreadsheets/d/${this._id}/edit`;
  }

  getSheets() {
    return [...this._sheets];
  }

  getSheetByName(name) {
    return this._sheets.find((sheet) => sheet.getName() === name) ?? null;
  }

  getNumSheets() {
    return this._sheets.length;
  }

  insertSheet(name, index = this._sheets.length) {
    return this._addSheet(name, index);
  }

  deleteSheet(sheet) {
    const index = this._sheets.indexOf(sheet);
    if (index < 0) throw new Error("このスプレッドシートにないシートです");
    if (this._sheets.length === 1)
      throw new Error("最後のシートは削除できません");
    this._sheets.splice(index, 1);
  }

  /** テスト用。名前でシートを返す。無ければ例外。 */
  sheet(name) {
    const sheet = this.getSheetByName(name);
    if (!sheet) throw new Error(`テスト用の取得: シートがありません: ${name}`);
    return sheet;
  }

  /** テスト用。シート名を左から並べて返す。 */
  sheetNames() {
    return this._sheets.map((sheet) => sheet.getName());
  }

  _checkFreeName(name) {
    if (!name) throw new Error("シート名が空です");
    if (this.getSheetByName(name))
      throw new Error(`同じ名前のシートが既にあります: ${name}`);
  }

  _addSheet(name, index = this._sheets.length) {
    this._checkFreeName(name);
    const sheet = strict(
      "Sheet",
      new FakeSheet(this, name, this._nextSheetId++),
    );
    this._sheets.splice(index, 0, sheet);
    return sheet;
  }
}

function toResponse({ status = 200, text, bytes = [] }) {
  const content = text ?? Buffer.from(bytes).toString("utf8");
  return strict("HTTPResponse", {
    getResponseCode: () => status,
    getContentText: () => content,
    getBlob: () =>
      strict("Blob", {
        getBytes: () => [...(text === undefined ? bytes : Buffer.from(text))],
      }),
  });
}

/**
 * Code.gs を偽の Apps Script 環境に読み込む。
 *
 * @param {LoadOptions} [options]
 */
export function loadGateway(options = {}) {
  const spreadsheet = strict(
    "Spreadsheet",
    new FakeSpreadsheet({
      id: options.spreadsheetId ?? "fake-spreadsheet-id",
      title: options.title ?? "経理スプレッドシート",
    }),
  );
  (options.sheets ?? []).forEach(({ name, rows = [] }) => {
    const sheet = spreadsheet.insertSheet(name);
    rows.forEach((line, r) =>
      line.forEach((value, c) => sheet._set(r + 1, c + 1, value)),
    );
  });

  // Code.gs は鍵を「スプレッドシートの ID:鍵」の形で保存する。
  // keyFromSpreadsheet を渡すと、別のスプレッドシートからコピーされた鍵を再現できる。
  const stored = new Map();
  if (options.key) {
    const owner = options.keyFromSpreadsheet ?? spreadsheet.getId();
    stored.set("KEIRI_KEY", `${owner}:${options.key}`);
  }
  const properties = strict("Properties", {
    getProperty: (name) => stored.get(name) ?? null,
    setProperty: (name, value) => {
      stored.set(name, String(value));
    },
    deleteProperty: (name) => {
      stored.delete(name);
    },
  });

  const locks = {
    busy: Boolean(options.lockBusy),
    tryLockCalls: 0,
    releaseCalls: 0,
  };
  const ui = { menus: [], dialogs: [] };
  const fetches = [];

  const gatewayUi = strict("Ui", {
    createMenu(title) {
      const items = [];
      const menu = strict("Menu", {
        addItem(label, functionName) {
          items.push({ label, functionName });
          return menu;
        },
        addToUi() {
          ui.menus.push({ title, items });
        },
      });
      return menu;
    },
    showModalDialog(html, title) {
      ui.dialogs.push({ file: html.file, rotate: html.rotate, title });
    },
  });

  const context = vm.createContext({
    SpreadsheetApp: strict("SpreadsheetApp", {
      getActiveSpreadsheet: () => spreadsheet,
      getUi: () => gatewayUi,
      flush: () => {},
      WrapStrategy: { WRAP: "WRAP", CLIP: "CLIP", OVERFLOW: "OVERFLOW" },
      BorderStyle: { SOLID: "SOLID" },
    }),
    PropertiesService: strict("PropertiesService", {
      getScriptProperties: () => properties,
    }),
    LockService: strict("LockService", {
      getScriptLock: () =>
        strict("Lock", {
          tryLock: () => {
            locks.tryLockCalls++;
            return !locks.busy;
          },
          releaseLock: () => {
            locks.releaseCalls++;
          },
        }),
    }),
    ContentService: strict("ContentService", {
      MimeType: { JSON: "JSON", TEXT: "TEXT" },
      createTextOutput: (text) => {
        const output = strict("TextOutput", {
          mimeType: "TEXT",
          getContent: () => text,
          setMimeType(mimeType) {
            output.mimeType = mimeType;
            return output;
          },
        });
        return output;
      },
    }),
    Utilities: strict("Utilities", {
      Charset: { UTF_8: "UTF_8" },
      getUuid: () => randomUUID(),
      base64Encode: (bytes) => Buffer.from(bytes).toString("base64"),
      base64EncodeWebSafe: (text) =>
        Buffer.from(text, "utf8")
          .toString("base64")
          .replace(/\+/g, "-")
          .replace(/\//g, "_"),
    }),
    ScriptApp: strict("ScriptApp", { getOAuthToken: () => "fake-oauth-token" }),
    HtmlService: strict("HtmlService", {
      createTemplateFromFile: (file) => {
        const template = strict("HtmlTemplate", {
          rotate: undefined,
          evaluate() {
            const output = strict("HtmlOutput", {
              file,
              rotate: template.rotate,
              width: 0,
              height: 0,
              setWidth(width) {
                output.width = width;
                return output;
              },
              setHeight(height) {
                output.height = height;
                return output;
              },
            });
            return output;
          },
        });
        return template;
      },
    }),
    UrlFetchApp: strict("UrlFetchApp", {
      fetch(url, params) {
        fetches.push({ url, params: structuredClone(params ?? {}) });
        const replaced = options.fetch?.(url, params ?? {});
        if (replaced) return toResponse(replaced);
        return toResponse(defaultFetch(url, params ?? {}));
      },
    }),
  });

  /** 同じ Code.gs の doPost への POST と、スプレッドシートの PDF 書き出し。ほかの URL は例外にする。 */
  function defaultFetch(url, params) {
    if (WEB_APP_URL.test(url)) {
      const output = context.doPost({ postData: { contents: params.payload } });
      return { text: output.getContent() };
    }
    const exported = EXPORT_URL.exec(url);
    if (exported) return { bytes: Buffer.from(`%PDF-fake:${exported[2]}`) };
    throw new Error(`偽の UrlFetchApp が知らない URL です: ${url}`);
  }

  vm.runInContext(GATEWAY_SOURCE, context);

  return {
    /** doPost を呼び、返ってきた TextOutput の中身を JSON として読んで返す。文字列はそのまま本文として送る。 */
    post(body) {
      const contents = typeof body === "string" ? body : JSON.stringify(body);
      return JSON.parse(
        context.doPost({ postData: { contents } }).getContent(),
      );
    },
    get() {
      return JSON.parse(context.doGet().getContent());
    },
    spreadsheet,
    properties,
    context,
    fetches,
    /** ロックの状態。busy を書き換えると、以後の tryLock の結果が変わる。 */
    locks,
    /** onOpen で作ったメニューと、開いたダイアログの記録。 */
    ui,
  };
}
