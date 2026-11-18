// ─── レポート機能 ─────────────────────────────────────────────────────────────────
// 週次・月次の「よく使う利用先」レポートを集計してメール送信する。
// GAS は同一プロジェクトのファイルがグローバルスコープを共有するため、
// rakuten-mail-import.gs の getExpensesSheet_ などをそのまま呼ぶ。
// 使い方: setupReportTriggers を一度手動実行すると、週次・月次の送信が自動で動く。

// メール送信先のフォールバックアドレス（Session.getActiveUser().getEmail() が空の場合に使用）
var REPORT_FALLBACK_TO = "";

// ─── 利用先表記ゆれ正規化 ─────────────────────────────────────────────────────────

/**
 * 利用先名の表記ゆれを正規化する。
 * - 先頭のカード利用プレフィックス（ＶＩＳＡ国内利用　VS  / ＪＣＢ国内利用　QP  / ＶＩＳＡ海外利用　 等）を除去
 * - 末尾の「利用国XX」（英大文字2字）を除去
 * - 末尾の連続数字・空白を除去
 * - 全角空白を半角化し、連続する空白を1つにまとめる
 * 正規化後が空になった場合は元の値を返す。
 * @param {string} raw
 * @returns {string}
 */
function normalizeMerchant_(raw) {
  var s = raw;

  // カード利用プレフィックスを除去
  // 例: "ＶＩＳＡ国内利用　VS " / "ＪＣＢ国内利用　QP " / "ＶＩＳＡ海外利用　"
  // [Ａ-Ｚ] = 全角大文字 Ａ〜Ｚ
  s = s.replace(/^[Ａ-Ｚ]+(国内|海外)利用[\s　]+([A-Z]{2,3}\s+)?/, "");

  // 末尾の「利用国XX」（英大文字 2 字）を除去
  s = s.replace(/利用国[A-Z]{2}\s*$/, "");

  // 末尾の連続数字・空白を除去（店舗番号等）
  s = s.replace(/[\d\s]+$/, "");

  // 全角空白を半角化、連続する空白を 1 つに
  s = s.replace(/　/g, " ").replace(/\s+/g, " ").trim();

  return s || raw;
}

// ─── 集計 ─────────────────────────────────────────────────────────────────────────

/**
 * fromYmd〜toYmd（YYYY-MM-DD、両端含む）の expenses 行を利用先ごとに集計する。
 * @param {string} fromYmd
 * @param {string} toYmd
 * @returns {{
 *   items: Array<{merchant: string, count: number, total: number, topCategory: string}>,
 *   summary: {total: number, count: number}
 * }}
 */
function aggregateMerchants_(fromYmd, toYmd) {
  var sheet = getExpensesSheet_();
  var lastRow = sheet.getLastRow();
  var summary = { total: 0, count: 0 };

  if (lastRow < 2) {
    return { items: [], summary: summary };
  }

  // 列順: A=id(0) B=date(1) C=merchant(2) D=amount(3) E=category(4) F=source(5)
  //        G=note(6) H=createdAt(7) I=updatedAt(8)
  var data = sheet.getRange(2, 1, lastRow - 1, 9).getValues();
  var map = {}; // normalized merchant → { count, total, categories }

  for (var r = 0; r < data.length; r++) {
    var row = data[r];
    var date = String(row[1]);
    var rawMerchant = String(row[2]);
    var amountStr = String(row[3]);
    var category = String(row[4]);

    if (date < fromYmd || date > toYmd) continue;

    var amount = parseInt(amountStr.replace(/[,，円\s]/g, ""), 10) || 0;
    var merchant = normalizeMerchant_(rawMerchant);

    if (!map[merchant]) {
      map[merchant] = { count: 0, total: 0, categories: {} };
    }
    var entry = map[merchant];
    entry.count++;
    entry.total += amount;
    entry.categories[category] = (entry.categories[category] || 0) + 1;

    summary.count++;
    summary.total += amount;
  }

  // topCategory を決定してアイテム配列に変換
  var merchantKeys = Object.keys(map);
  var items = [];
  for (var i = 0; i < merchantKeys.length; i++) {
    var key = merchantKeys[i];
    var ent = map[key];
    var topCategory = "";
    var topCount = 0;
    var catKeys = Object.keys(ent.categories);
    for (var j = 0; j < catKeys.length; j++) {
      if (ent.categories[catKeys[j]] > topCount) {
        topCount = ent.categories[catKeys[j]];
        topCategory = catKeys[j];
      }
    }
    items.push({
      merchant: key,
      count: ent.count,
      total: ent.total,
      topCategory: topCategory,
    });
  }

  // 回数の多い順（同数なら合計金額の多い順）
  items.sort(function (a, b) {
    if (b.count !== a.count) return b.count - a.count;
    return b.total - a.total;
  });

  return { items: items, summary: summary };
}

// ─── HTML メール生成 ───────────────────────────────────────────────────────────────

/**
 * 数値を ¥X,XXX 形式の文字列に変換する。
 * @param {number} n
 * @returns {string}
 */
function formatAmount_(n) {
  var abs = String(Math.abs(Math.round(n)));
  var result = "";
  for (var i = abs.length - 1, k = 0; i >= 0; i--, k++) {
    if (k > 0 && k % 3 === 0) result = "," + result;
    result = abs[i] + result;
  }
  return (n < 0 ? "-¥" : "¥") + result;
}

/**
 * HTML エスケープ。
 * @param {string} s
 * @returns {string}
 */
function escapeHtml_(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * サマリカード HTML を生成する（メール内のハイライトブロック用）。
 * @param {string} label
 * @param {string} value
 * @returns {string}
 */
function summaryCard_(label, value) {
  return (
    '<td style="padding:8px 16px 8px 0;vertical-align:top;">' +
    '<div style="background:#f0f7f2;border-radius:6px;padding:12px 16px;min-width:110px;">' +
    '<div style="font-size:11px;color:#666;margin-bottom:4px;">' +
    escapeHtml_(label) +
    "</div>" +
    '<div style="font-size:18px;font-weight:700;color:#1a5c38;">' +
    escapeHtml_(value) +
    "</div>" +
    "</div></td>"
  );
}

/**
 * 利用先レポートの HTML メール本文を生成する。
 * @param {string} title
 * @param {string} fromYmd  YYYY-MM-DD
 * @param {string} toYmd    YYYY-MM-DD
 * @param {{ items: Array, summary: object }} agg  aggregateMerchants_ の戻り値
 * @returns {string}
 */
function buildReportHtml_(title, fromYmd, toYmd, agg) {
  var items = agg.items;
  var summary = agg.summary;
  var top15 = items.slice(0, 15);

  var rankRows = "";
  for (var i = 0; i < top15.length; i++) {
    var item = top15[i];
    var bg = i % 2 === 0 ? "#ffffff" : "#fafafa";
    rankRows +=
      '<tr style="background:' +
      bg +
      ';border-bottom:1px solid #eeeeee;">' +
      '<td style="padding:8px 10px;text-align:center;color:#999;font-size:13px;">' +
      (i + 1) +
      "</td>" +
      '<td style="padding:8px 10px;font-size:14px;">' +
      escapeHtml_(item.merchant) +
      "</td>" +
      '<td style="padding:8px 10px;text-align:right;font-size:13px;">' +
      item.count +
      "回</td>" +
      '<td style="padding:8px 10px;text-align:right;font-weight:700;font-size:14px;">' +
      formatAmount_(item.total) +
      "</td>" +
      '<td style="padding:8px 10px;font-size:13px;color:#555;">' +
      escapeHtml_(item.topCategory) +
      "</td>" +
      "</tr>";
  }

  if (top15.length === 0) {
    rankRows =
      '<tr><td colspan="5" style="padding:16px;text-align:center;color:#999;">この期間の取引データはありません。</td></tr>';
  }

  return (
    '<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"></head><body>' +
    "<div style=\"font-family:-apple-system,BlinkMacSystemFont,'Hiragino Kaku Gothic ProN','Yu Gothic',sans-serif;max-width:680px;margin:0 auto;padding:24px 16px;color:#1a1a1a;\">" +
    '<h2 style="margin:0 0 4px;font-size:20px;">' +
    escapeHtml_(title) +
    "</h2>" +
    '<p style="color:#888;margin:0 0 20px;font-size:13px;">集計期間: ' +
    fromYmd +
    " 〜 " +
    toYmd +
    "</p>" +
    '<table cellpadding="0" cellspacing="0" style="margin-bottom:24px;"><tr>' +
    summaryCard_("合計金額", formatAmount_(summary.total)) +
    summaryCard_("件数", summary.count + "件") +
    "</tr></table>" +
    '<h3 style="margin:0 0 8px;font-size:15px;font-weight:600;">利用先ランキング（上位15）</h3>' +
    '<table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;font-size:14px;">' +
    '<thead><tr style="background:#f4f4f4;border-bottom:2px solid #ddd;">' +
    '<th style="padding:8px 10px;text-align:center;font-size:12px;font-weight:600;">#</th>' +
    '<th style="padding:8px 10px;text-align:left;font-weight:600;">利用先</th>' +
    '<th style="padding:8px 10px;text-align:right;font-weight:600;">回数</th>' +
    '<th style="padding:8px 10px;text-align:right;font-weight:600;">合計</th>' +
    '<th style="padding:8px 10px;text-align:left;font-weight:600;">主な費目</th>' +
    "</tr></thead>" +
    "<tbody>" +
    rankRows +
    "</tbody>" +
    "</table>" +
    '<p style="font-size:11px;color:#bbb;margin-top:16px;">このメールは keiri-app の Apps Script により自動送信されました。</p>' +
    "</div></body></html>"
  );
}

// ─── 日付ユーティリティ ───────────────────────────────────────────────────────────

/**
 * Date を Asia/Tokyo の "YYYY-MM-DD" 文字列に変換する。
 * @param {Date} date
 * @returns {string}
 */
function toYmd_(date) {
  return Utilities.formatDate(date, "Asia/Tokyo", "yyyy-MM-dd");
}

/**
 * "YYYY-MM-DD" を "M/D" に変換する。
 * @param {string} ymd
 * @returns {string}
 */
function ymdToMD_(ymd) {
  var parts = ymd.split("-");
  return parseInt(parts[1], 10) + "/" + parseInt(parts[2], 10);
}

/**
 * 送信先アドレスを返す。Session から取れなければフォールバック定数を使う。
 * @returns {string}
 */
function getReportTo_() {
  try {
    var email = Session.getActiveUser().getEmail();
    if (email) return email;
  } catch (e) {
    // 権限エラー等は無視してフォールバックへ
  }
  return REPORT_FALLBACK_TO;
}

/**
 * referenceDate の前週（月曜日〜日曜日）を Asia/Tokyo の "YYYY-MM-DD" で返す。
 * 毎週月曜のトリガー実行時は、直前の月曜〜日曜を集計対象にする。
 * @param {Date} referenceDate
 * @returns {{from: string, to: string}}
 */
function getLastWeekRangeYmd_(referenceDate) {
  var dowStr = Utilities.formatDate(referenceDate, "Asia/Tokyo", "u");
  var dow = parseInt(dowStr, 10);
  if (isNaN(dow) || dow < 1 || dow > 7) dow = 1;

  var daysFromMonday = dow - 1;
  var thisMondayMs = referenceDate.getTime() - daysFromMonday * 86400000;
  var lastMondayMs = thisMondayMs - 7 * 86400000;
  var lastSundayMs = thisMondayMs - 86400000;

  return {
    from: toYmd_(new Date(lastMondayMs)),
    to: toYmd_(new Date(lastSundayMs)),
  };
}

// ─── メール送信 ───────────────────────────────────────────────────────────────────

/**
 * Script Properties から APP_BASE_URL と PUSH_SECRET を取得して
 * /api/push/send にプッシュ通知リクエストを送る。
 * 失敗しても本処理（メール）は止めない。
 * @param {'weekly'|'monthly'} type
 * @param {{from: string, to: string}=} range
 */
function pingPushNotification_(type, range) {
  try {
    var props = PropertiesService.getScriptProperties();
    var baseUrl = props.getProperty("APP_BASE_URL");
    var pushSecret = props.getProperty("PUSH_SECRET");
    if (!baseUrl || !pushSecret) {
      Logger.log(
        "プッシュ通知スキップ: APP_BASE_URL または PUSH_SECRET が未設定",
      );
      return;
    }
    var url = baseUrl.replace(/\/$/, "") + "/api/push/send";
    var body = { type: type };
    if (range) body.range = range;
    var payload = JSON.stringify(body);
    var res = UrlFetchApp.fetch(url, {
      method: "post",
      contentType: "application/json",
      payload: payload,
      headers: { "x-push-secret": pushSecret },
      muteHttpExceptions: true,
    });
    Logger.log(
      "プッシュ通知レスポンス: " +
        res.getResponseCode() +
        " " +
        res.getContentText(),
    );
  } catch (e) {
    Logger.log("プッシュ通知エラー（無視）: " + e);
  }
}

/**
 * 先週（月曜〜日曜）のよく使う利用先レポートをメール送信する。
 * 毎週月曜 8 時台のトリガーで呼び出す。
 */
function sendWeeklyReport() {
  var today = new Date();
  var lastWeekRange = getLastWeekRangeYmd_(today);

  var agg = aggregateMerchants_(lastWeekRange.from, lastWeekRange.to);

  var fromMD = ymdToMD_(lastWeekRange.from);
  var toMD = ymdToMD_(lastWeekRange.to);
  var subject =
    "【keiri】先週のよく使う利用先レポート（" + fromMD + "〜" + toMD + "）";
  var htmlBody = buildReportHtml_(
    "先週のよく使う利用先レポート",
    lastWeekRange.from,
    lastWeekRange.to,
    agg,
  );

  MailApp.sendEmail({
    to: getReportTo_(),
    subject: subject,
    htmlBody: htmlBody,
  });
  Logger.log("週次レポート送信完了: " + subject);

  pingPushNotification_("weekly", lastWeekRange);
}

/**
 * 今月（1日〜今日）のよく使う利用先レポートをメール送信する。
 * 毎月 1 日 8 時台のトリガーで呼び出す（1日なので fromYmd = todayYmd になる）。
 */
function sendMonthlyReport() {
  var today = new Date();
  var todayYmd = toYmd_(today);

  var year = parseInt(Utilities.formatDate(today, "Asia/Tokyo", "yyyy"), 10);
  var month = parseInt(Utilities.formatDate(today, "Asia/Tokyo", "M"), 10);
  var mm = month < 10 ? "0" + month : String(month);
  var firstDayYmd = year + "-" + mm + "-01";

  var agg = aggregateMerchants_(firstDayYmd, todayYmd);

  var subject =
    "【keiri】今月のよく使う利用先レポート（" + year + "年" + month + "月）";
  var htmlBody = buildReportHtml_(
    "今月のよく使う利用先レポート",
    firstDayYmd,
    todayYmd,
    agg,
  );

  MailApp.sendEmail({
    to: getReportTo_(),
    subject: subject,
    htmlBody: htmlBody,
  });
  Logger.log("月次レポート送信完了: " + subject);

  pingPushNotification_("monthly");
}

// ─── トリガー管理 ─────────────────────────────────────────────────────────────────

/**
 * 週次（毎週月曜・午前8時台）と月次（毎月1日・午前8時台）のトリガーを冪等に作成する。
 * 同ハンドラの既存トリガーを削除してから新規作成する。
 * 一度だけ手動実行すること（実行後に OAuth 送信権限の再認可が必要）。
 */
function setupReportTriggers() {
  var handlers = ["sendWeeklyReport", "sendMonthlyReport"];
  var triggers = ScriptApp.getProjectTriggers();

  for (var i = 0; i < triggers.length; i++) {
    var fn = triggers[i].getHandlerFunction();
    for (var j = 0; j < handlers.length; j++) {
      if (fn === handlers[j]) {
        ScriptApp.deleteTrigger(triggers[i]);
        Logger.log("既存トリガーを削除: " + fn);
      }
    }
  }

  // 週次: 毎週月曜 8 時台
  ScriptApp.newTrigger("sendWeeklyReport")
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.MONDAY)
    .atHour(8)
    .create();

  // 月次: 毎月 1 日 8 時台
  ScriptApp.newTrigger("sendMonthlyReport")
    .timeBased()
    .onMonthDay(1)
    .atHour(8)
    .create();

  Logger.log(
    "レポートトリガーを設定しました（週次: 毎週月曜 8 時台 / 月次: 毎月 1 日 8 時台）。",
  );
}
