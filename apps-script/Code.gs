/**
 * keiri-app の窓口。
 *
 * このスプレッドシートを、keiri-app（Cloudflare Workers で動くアプリ）から読み書きできるようにする。
 * アプリは「ウェブアプリ」として公開したこのスクリプトへ、接続コードに含まれる鍵を付けて要求を送る。
 * 帳簿のきまり（採番の形、税の計算、帳票の配置）はアプリ側にある。ここが受け持つのは、
 * 表の読み書き、帳票のタブの複製と書き込み、PDF の書き出しだけ。
 */

const PROTOCOL_VERSION = 1;
const KEY_PROPERTY = "KEIRI_KEY";
const GENERATED_MARK = "keiri-app:generated";
const CODE_PREFIX = "keiri1_";
const LOCK_WAIT_MS = 25000;
const MAX_COLUMNS = 26;
const TEMPLATE_PREFIX = "書式_";
/** アプリが作る帳票のタブの名前の形。 */
const GENERATED_NAME = /^(請求書|見積書|納品書|発注書|領収書)_/;
/** PDF の書き出しで、アプリが指定してよい項目。 */
const PDF_PARAMS = [
  "size",
  "portrait",
  "scale",
  "sheetnames",
  "printtitle",
  "pagenumbers",
  "gridlines",
  "fzr",
];

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("keiri-app")
    .addItem("接続コードを発行", "openConnectionDialog")
    .addItem("接続コードを作り直す", "openRotateDialog")
    .addToUi();
}

function openConnectionDialog() {
  showDialog_(false);
}

function openRotateDialog() {
  showDialog_(true);
}

function showDialog_(rotate) {
  const template = HtmlService.createTemplateFromFile("Dialog");
  template.rotate = rotate;
  const html = template.evaluate().setWidth(520).setHeight(540);
  SpreadsheetApp.getUi().showModalDialog(
    html,
    rotate ? "接続コードを作り直す" : "接続コードを発行",
  );
}

/**
 * ウェブアプリの URL を受け取り、接続コードを返す。ダイアログから呼ばれる。
 * 発行する前に、その URL へ実際に要求を送って、アプリから届く状態かを確かめる。
 */
function issueConnectionCode(url, rotate) {
  const webAppUrl = String(url || "").trim();
  if (
    !/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(webAppUrl)
  ) {
    throw new Error(
      "ウェブアプリの URL の形が違います。https://script.google.com/macros/s/…/exec の形の URL を貼り付けてください。",
    );
  }
  const properties = PropertiesService.getScriptProperties();
  const previous = properties.getProperty(KEY_PROPERTY);
  let key = storedKey_();
  if (!key || rotate) {
    key = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, "");
    properties.setProperty(KEY_PROPERTY, keyRecord_(key));
  }
  try {
    checkWebApp_(webAppUrl, key);
  } catch (error) {
    // 届かなかったときは、今までの鍵に戻す。作り直しに失敗して、使える鍵が無くなるのを防ぐ。
    if (previous) properties.setProperty(KEY_PROPERTY, previous);
    else properties.deleteProperty(KEY_PROPERTY);
    throw error;
  }
  const payload = JSON.stringify({
    u: webAppUrl,
    k: key,
    s: SpreadsheetApp.getActiveSpreadsheet().getId(),
  });
  return (
    CODE_PREFIX +
    Utilities.base64EncodeWebSafe(payload, Utilities.Charset.UTF_8).replace(
      /=+$/,
      "",
    )
  );
}

/**
 * 鍵は「このスプレッドシートの ID:鍵」の形で保存する。
 * スプレッドシートをコピーすると、スクリプトのプロパティも写ることがある。
 * ID が今のスプレッドシートと違う鍵は、コピー元のものなので使わない。
 */
function keyRecord_(key) {
  return SpreadsheetApp.getActiveSpreadsheet().getId() + ":" + key;
}

function storedKey_() {
  const record =
    PropertiesService.getScriptProperties().getProperty(KEY_PROPERTY);
  const prefix = SpreadsheetApp.getActiveSpreadsheet().getId() + ":";
  return record && record.indexOf(prefix) === 0
    ? record.slice(prefix.length)
    : "";
}

function checkWebApp_(url, key) {
  const response = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "text/plain",
    payload: JSON.stringify({ key: key, calls: [{ op: "info" }] }),
    muteHttpExceptions: true,
  });
  let body = null;
  try {
    body = JSON.parse(response.getContentText());
  } catch (error) {
    body = null;
  }
  if (!body || body.ok !== true) {
    throw new Error(
      "ウェブアプリに届きませんでした。デプロイの設定で「次のユーザーとして実行」を「自分」、「アクセスできるユーザー」を「全員」にして、もう一度デプロイしてください。",
    );
  }
  if (
    body.results[0].spreadsheetId !==
    SpreadsheetApp.getActiveSpreadsheet().getId()
  ) {
    throw new Error(
      "貼り付けた URL は、別のスプレッドシートのウェブアプリです。このスプレッドシートの Apps Script でデプロイした URL を貼り付けてください。",
    );
  }
}

function doGet() {
  return json_({ ok: true, service: "keiri-app", v: PROTOCOL_VERSION });
}

function doPost(e) {
  let request;
  try {
    request = JSON.parse(e.postData.contents);
  } catch (error) {
    return json_(failure_("bad_request", "要求を JSON として読めません"));
  }
  if (typeof request !== "object" || request === null) {
    return json_(failure_("bad_request", "要求の形が違います"));
  }
  const expected = storedKey_();
  if (!expected) {
    return json_(
      failure_("not_configured", "接続コードがまだ発行されていません"),
    );
  }
  if (!sameText_(String(request.key || ""), expected)) {
    return json_(failure_("unauthorized", "接続コードが違います"));
  }
  if (!Array.isArray(request.calls) || request.calls.length === 0) {
    return json_(failure_("bad_request", "calls がありません"));
  }
  return json_(run_(request.calls));
}

function run_(calls) {
  const unknown = calls.filter(function (call) {
    return !call || !own_(OPS, call.op);
  });
  if (unknown.length > 0) {
    return failure_(
      "bad_request",
      "知らない操作です: " + String(unknown[0] && unknown[0].op),
    );
  }
  const needsLock = calls.some(function (call) {
    return !own_(READ_ONLY_OPS, call.op);
  });
  const lock = needsLock ? LockService.getScriptLock() : null;
  if (lock && !lock.tryLock(LOCK_WAIT_MS)) {
    return failure_(
      "busy",
      "ほかの書き込みが終わりませんでした。少し待ってやり直してください",
    );
  }
  try {
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const results = calls.map(function (call) {
      return OPS[call.op](spreadsheet, call);
    });
    SpreadsheetApp.flush();
    return { ok: true, v: PROTOCOL_VERSION, results: results };
  } catch (error) {
    if (error instanceof GatewayError_)
      return failure_(error.code, error.message);
    return failure_("internal", String((error && error.message) || error));
  } finally {
    if (lock) lock.releaseLock();
  }
}

const READ_ONLY_OPS = { info: true, read: true, exportPdf: true };

const OPS = {
  info: function (spreadsheet) {
    return {
      spreadsheetId: spreadsheet.getId(),
      title: spreadsheet.getName(),
      url: spreadsheet.getUrl(),
      tabs: spreadsheet.getSheets().map(function (sheet) {
        return { name: sheet.getName(), gid: sheet.getSheetId() };
      }),
    };
  },

  ensureTabs: function (spreadsheet, call) {
    const created = [];
    call.tabs.forEach(function (tab) {
      if (spreadsheet.getSheetByName(tab.name)) return;
      const sheet = spreadsheet.insertSheet(
        tab.name,
        spreadsheet.getNumSheets(),
      );
      writeText_(sheet, 1, [tab.header]);
      sheet.setFrozenRows(1);
      created.push(tab.name);
    });
    return { created: created };
  },

  read: function (spreadsheet, call) {
    const tables = {};
    call.tabs.forEach(function (name) {
      const sheet =
        String(name).indexOf(TEMPLATE_PREFIX) === 0
          ? null
          : spreadsheet.getSheetByName(name);
      tables[name] = sheet ? readRows_(sheet) : null;
    });
    return tables;
  },

  append: function (spreadsheet, call) {
    if (call.rows.length === 0) return { appended: 0 };
    const sheet = table_(spreadsheet, call.tab);
    writeText_(sheet, nextRow_(sheet), call.rows);
    return { appended: call.rows.length };
  },

  updateById: function (spreadsheet, call) {
    const sheet = table_(spreadsheet, call.tab);
    const row = findRow_(sheet, call.id);
    if (!row)
      throw new GatewayError_(
        "not_found",
        call.tab + " に " + call.id + " がありません",
      );
    writeText_(sheet, row, [call.row]);
    return {};
  },

  upsertById: function (spreadsheet, call) {
    const sheet = table_(spreadsheet, call.tab);
    const row = findRow_(sheet, call.id);
    writeText_(sheet, row || nextRow_(sheet), [call.row]);
    return { created: !row };
  },

  deleteById: function (spreadsheet, call) {
    const sheet = table_(spreadsheet, call.tab);
    const row = findRow_(sheet, call.id);
    if (row) sheet.deleteRow(row);
    return { deleted: Boolean(row) };
  },

  nextSeq: function (spreadsheet, call) {
    const sheet = table_(spreadsheet, call.tab);
    const row = findRow_(sheet, call.key);
    const stored = row
      ? Number.parseInt(sheet.getRange(row, 2).getDisplayValue(), 10) || 0
      : 0;
    const seq = Math.max(stored, Number(call.floor) || 0, 0) + 1;
    writeText_(sheet, row || nextRow_(sheet), [[call.key, String(seq)]]);
    return { seq: seq };
  },

  renderSheet: function (spreadsheet, call) {
    const template = spreadsheet.getSheetByName(call.template);
    if (!template)
      throw new GatewayError_(
        "not_found",
        "書式のタブがありません: " + call.template,
      );
    // タブを作る前に手順を確かめる。作ったあとで断ると、消せないタブが残るため。
    call.steps.forEach(function (step) {
      if (!step || !own_(STEPS, step.do)) {
        throw new GatewayError_(
          "bad_request",
          "知らない手順です: " + String(step && step.do),
        );
      }
    });
    // 新しいタブを作り終えて行を保存できるまで、前のタブは消さない。
    // 途中で失敗したら作りかけのタブだけを消し、書類は前のタブを指したままにする。
    const sheet = template.copyTo(spreadsheet);
    try {
      sheet.setName(freeName_(spreadsheet, call.name));
      sheet.addDeveloperMetadata(GENERATED_MARK, "1");
      call.steps.forEach(function (step) {
        STEPS[step.do](sheet, step);
      });
    } catch (error) {
      spreadsheet.deleteSheet(sheet);
      throw error;
    }
    // 名前を付け直す前に前のタブを消したいが、前のタブは行を保存できてから消す。
    // そのため、名前を付け直すのは前のタブを消したあとにし、行には付け直した名前を保存し直す。
    const made = describeSheet_(spreadsheet, sheet);
    try {
      if (call.save) saveWithSheet_(spreadsheet, call.save, made);
    } catch (error) {
      spreadsheet.deleteSheet(sheet);
      throw error;
    }
    if (call.replaceGid != null) {
      deleteGenerated_(spreadsheet, call.replaceGid, call.replaceName);
    }
    if (
      sheet.getName() !== call.name &&
      !spreadsheet.getSheetByName(call.name)
    ) {
      sheet.setName(call.name);
      made.name = sheet.getName();
      if (call.save) saveWithSheet_(spreadsheet, call.save, made);
    }
    return made;
  },

  deleteSheet: function (spreadsheet, call) {
    return { deleted: deleteGenerated_(spreadsheet, call.gid, call.name) };
  },

  exportPdf: function (spreadsheet, call) {
    const sheet = sheetByGid_(spreadsheet, call.gid);
    if (!sheet) throw new GatewayError_("not_found", "帳票のタブがありません");
    const query = ["format=pdf", "gid=" + sheet.getSheetId()];
    Object.keys(call.params || {}).forEach(function (name) {
      if (PDF_PARAMS.indexOf(name) >= 0) {
        query.push(name + "=" + encodeURIComponent(String(call.params[name])));
      }
    });
    const response = UrlFetchApp.fetch(
      "https://docs.google.com/spreadsheets/d/" +
        spreadsheet.getId() +
        "/export?" +
        query.join("&"),
      {
        headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() },
        muteHttpExceptions: true,
      },
    );
    if (response.getResponseCode() !== 200) {
      throw new GatewayError_(
        "internal",
        "PDF を書き出せませんでした (" + response.getResponseCode() + ")",
      );
    }
    return { base64: Utilities.base64Encode(response.getBlob().getBytes()) };
  },
};

const STEPS = {
  unmerge: function (sheet, step) {
    sheet
      .getRange(step.range)
      .getMergedRanges()
      .forEach(function (range) {
        range.breakApart();
      });
  },
  insertRowsAfter: function (sheet, step) {
    sheet.insertRowsAfter(step.row, step.count);
  },
  values: function (sheet, step) {
    // 文字は先頭に ' を付けて、入力したとおりの文字として書く。取引先名や品名が
    // = で始まっていても、数式として計算されない（' 自体はセルに残らない）。数値はそのまま書く。
    const values = step.values.map(function (cells) {
      return cells.map(function (cell) {
        return typeof cell === "number" ? cell : asText_(cell);
      });
    });
    sheet.getRange(step.range).setValues(values);
  },
  merge: function (sheet, step) {
    sheet.getRange(step.range).merge();
  },
  showRows: function (sheet, step) {
    sheet.showRows(step.from, step.count);
  },
  hideRows: function (sheet, step) {
    sheet.hideRows(step.from, step.count);
  },
  rowHeight: function (sheet, step) {
    sheet.setRowHeight(step.row, step.px);
  },
  format: function (sheet, step) {
    const range = sheet.getRange(step.range);
    if (step.wrap) range.setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP);
    if (step.vertical) range.setVerticalAlignment(step.vertical);
    if (step.horizontal) range.setHorizontalAlignment(step.horizontal);
  },
  borderBottom: function (sheet, step) {
    sheet
      .getRange(step.range)
      .setBorder(
        null,
        null,
        true,
        null,
        null,
        null,
        "#000000",
        SpreadsheetApp.BorderStyle.SOLID,
      );
  },
};

/** 表に自分で定義した名前だけを通す。toString のような、どのオブジェクトにもある名前は通さない。 */
function own_(table, name) {
  return (
    typeof name === "string" &&
    Object.prototype.hasOwnProperty.call(table, name)
  );
}

function GatewayError_(code, message) {
  this.code = code;
  this.message = message;
}

function failure_(code, message) {
  return {
    ok: false,
    v: PROTOCOL_VERSION,
    error: { code: code, message: message },
  };
}

function json_(body) {
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(
    ContentService.MimeType.JSON,
  );
}

function sameText_(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** 表のタブ。書式のタブ（書式_ で始まる）は、表として読み書きさせない。 */
function table_(spreadsheet, name) {
  if (String(name).indexOf(TEMPLATE_PREFIX) === 0) {
    throw new GatewayError_(
      "bad_request",
      "書式のタブは表として扱えません: " + name,
    );
  }
  const sheet = spreadsheet.getSheetByName(name);
  if (!sheet) throw new GatewayError_("not_found", "タブがありません: " + name);
  return sheet;
}

function sheetByGid_(spreadsheet, gid) {
  const sheets = spreadsheet.getSheets();
  for (let i = 0; i < sheets.length; i++) {
    if (String(sheets[i].getSheetId()) === String(gid)) return sheets[i];
  }
  return null;
}

function readRows_(sheet) {
  const rows = sheet.getLastRow();
  const columns = Math.min(sheet.getLastColumn(), MAX_COLUMNS);
  if (rows === 0 || columns === 0) return [];
  const values = sheet.getRange(1, 1, rows, columns).getDisplayValues();
  // 右の列だけに何かが入った行が下にあると、getLastRow はそこまで伸びる。末尾の空行は返さない。
  let last = values.length;
  while (
    last > 1 &&
    values[last - 1].every(function (cell) {
      return cell === "";
    })
  )
    last--;
  return values.slice(0, last);
}

/**
 * 行を足す位置。1 列目（id）が入っている最後の行の次。
 * 利用者が右の列に数式を下まで入れていても、表の続きに足す。
 */
function nextRow_(sheet) {
  const last = sheet.getLastRow();
  if (last < 1) return 1;
  const ids = sheet.getRange(1, 1, last, 1).getDisplayValues();
  let row = ids.length;
  while (row > 1 && ids[row - 1][0] === "") row--;
  return row + 1;
}

/** 1 列目が id の行番号を返す。見出し行は探さない。無ければ 0。 */
function findRow_(sheet, id) {
  const last = sheet.getLastRow();
  if (last < 2) return 0;
  const ids = sheet.getRange(2, 1, last - 1, 1).getDisplayValues();
  for (let i = 0; i < ids.length; i++) {
    if (ids[i][0] === String(id)) return i + 2;
  }
  return 0;
}

/**
 * 値を、入力したとおりの文字列として書く。
 * 先頭に ' を付けると、日付や数値や数式として解釈されない（' 自体はセルに残らない）。
 */
function writeText_(sheet, row, rows) {
  const width = rows.reduce(function (max, cells) {
    return Math.max(max, cells.length);
  }, 0);
  const values = rows.map(function (cells) {
    const line = [];
    for (let i = 0; i < width; i++) line.push(asText_(cells[i]));
    return line;
  });
  sheet.getRange(row, 1, values.length, width).setValues(values);
}

/** 作った帳票のタブの、アプリへ返す情報。 */
function describeSheet_(spreadsheet, sheet) {
  return {
    gid: String(sheet.getSheetId()),
    name: sheet.getName(),
    spreadsheetId: spreadsheet.getId(),
    url:
      "https://docs.google.com/spreadsheets/d/" +
      spreadsheet.getId() +
      "/edit#gid=" +
      sheet.getSheetId(),
  };
}

/**
 * 帳票のタブを作ったのと同じロックの中で、その帳票の行を保存する。
 * fill は「列の番号（0 始まり）→ 作ったタブの項目名」で、行のその列に gid や URL を入れる。
 */
function saveWithSheet_(spreadsheet, save, made) {
  const row = save.row.slice();
  Object.keys(save.fill || {}).forEach(function (column) {
    row[Number(column)] = made[save.fill[column]];
  });
  const sheet = table_(spreadsheet, save.tab);
  writeText_(sheet, findRow_(sheet, save.id) || nextRow_(sheet), [row]);
}

/** 入力したとおりの文字として書くための値。空は空のまま。 */
function asText_(value) {
  const text = value == null ? "" : String(value);
  return text === "" ? "" : "'" + text;
}

function freeName_(spreadsheet, wanted) {
  let name = wanted;
  for (let n = 2; spreadsheet.getSheetByName(name); n++)
    name = wanted + " (" + n + ")";
  return name;
}

/**
 * アプリが作った帳票のタブだけを消す。表のタブや書式のタブは、gid を渡されても消さない。
 * 印の無い古い帳票のタブ（印を付ける前の版で作ったもの）は、書類が覚えている名前と一致し、
 * かつ帳票のタブの名前の形（請求書_ などで始まる）のときだけ消す。
 */
function deleteGenerated_(spreadsheet, gid, name) {
  const sheet = sheetByGid_(spreadsheet, gid);
  if (!sheet) return false;
  const marked = sheet.getDeveloperMetadata().some(function (metadata) {
    return metadata.getKey() === GENERATED_MARK;
  });
  const legacy =
    Boolean(name) && sheet.getName() === name && GENERATED_NAME.test(name);
  if (!marked && !legacy) return false;
  spreadsheet.deleteSheet(sheet);
  return true;
}
