/**
 * 楽天カード「カード利用のお知らせ」を Gmail から取込み、
 * Google Sheets の expenses タブに追記する GAS スクリプト。
 * 速報版は確定待ちとして登録し、確定版到着後に同日同額の行を置換する。
 *
 * 取込先スプレッドシートは下の SPREADSHEET_ID 定数で指定する（Script Property
 * SPREADSHEET_ID があればそちらを優先）。
 * GEMINI_API_KEY を Script Property に入れると、ルール未確定の費目を AI で補完する
 * （任意。未設定なら未確定は「要確認」になる）。
 *
 * 初回セットアップ（コードを clasp で push したあと）:
 *   1. importRakutenMail を一度手動実行して OAuth 認可（Gmail/Sheets）を完了させる
 *   2. setupTrigger を一度手動実行して 1 時間ごとのトリガーを設定する
 */

// バックエンドのスプレッドシート ID（expenses タブを持つもの）。自分の ID に書き換える。
var SPREADSHEET_ID = "YOUR_SPREADSHEET_ID";
var PRELIMINARY_MERCHANT = "利用先未確定（楽天速報）";
var PRELIMINARY_SOURCE = "楽天速報";
var PRELIMINARY_NOTE = "確定版待ち";

// ─── 費目カテゴリ（src/domain/expense.ts の EXPENSE_CATEGORIES と一致させること）───

var CATEGORIES = [
  "旅費交通費",
  "通信費",
  "消耗品費",
  "会議費",
  "接待交際費",
  "広告宣伝費",
  "新聞図書費",
  "研修費",
  "支払手数料",
  "外注費",
  "荷造運賃",
  "水道光熱費",
  "地代家賃",
  "修繕費",
  "保険料",
  "租税公課",
  "福利厚生費",
  "車両費",
  "諸会費",
  "雑費",
  "要確認",
];

// ─── 確定ルール辞書（classify.mjs の RULES を移植）────────────────────────────────

var RULES = [
  [
    /JR|新幹線|ＥＸ|EX予約|ｽｲｶ|SUICA|ICOCA|PASMO|ﾊﾟｽﾓ|ﾒﾄﾛ|メトロ|地下鉄|都営|京急|東急|小田急|西武|京王|ﾊﾞｽ|ﾀｸｼｰ|タクシー|\bGO\b|DiDi|S\.RIDE|ANA|JAL|航空|空港|鉄道/i,
    "旅費交通費",
  ],
  [
    /ｴﾈｵｽ|ENEOS|ｺｽﾓ|COSMO|ｴｯｿ|出光|ｼｪﾙ|SHELL|ｶﾞｿﾘﾝ|ガソリン|ＥＴＣ|\bETC\b|洗車|ﾓｰﾀｰｽﾞ|ﾊﾟｰｸ24|times|ﾀｲﾑｽﾞ駐車|駐車場/i,
    "車両費",
  ],
  [
    /ﾄﾞｺﾓ|docomo|\bau\b|ｿﾌﾄﾊﾞﾝｸ|softbank|楽天ﾓﾊﾞｲﾙ|楽天モバイル|ﾗｸﾃﾝﾓﾊﾞｲﾙ|IIJ|OCN|ﾌﾚｯﾂ|NTT|AWS|amazon web|ｱﾏｿﾞﾝｳｪﾌﾞ|GCP|google cloud|google workspace|azure|cloudflare|vercel|netlify|github|slack|zoom|notion|dropbox|microsoft|office\s?365|openai|chatgpt|anthropic|claude|figma|adobe|ｻｸﾗｲﾝﾀｰﾈｯﾄ|さくら|ｺﾝｵﾌ|conoha|xserver|ｴｯｸｽｻｰﾊﾞｰ/i,
    "通信費",
  ],
  [
    /google\s?ads|ﾒﾀ|meta|facebook|ﾌｪｲｽﾌﾞｯｸ|instagram|x\s?ads|twitter|ﾔﾌｰ広告|yahoo!?\s?ads|ﾘｽﾃｨﾝｸﾞ|pixta|ﾋﾟｸｽﾀ|ｲﾗｽﾄ|canva|広告/i,
    "広告宣伝費",
  ],
  [
    /ﾔﾏﾄ|ヤマト|ｸﾛﾈｺ|佐川|ｻｶﾞﾜ|日本郵便|郵便局|ゆうﾊﾟｯｸ|ゆうパック|ﾚﾀｰﾊﾟｯｸ|宅配/i,
    "荷造運賃",
  ],
  [
    /ﾗﾝｻｰｽﾞ|lancers|ｸﾗｳﾄﾞﾜｰｸｽ|crowdworks|upwork|fiverr|ｺﾞｺﾞ|外注|業務委託/i,
    "外注費",
  ],
  [
    /書店|ﾌﾞｯｸ|books|丸善|紀伊國屋|ｼﾞｭﾝｸ堂|kindle|ｷﾝﾄﾞﾙ|o'reilly|ｵﾗｲﾘｰ|新聞|日経|日本経済新聞|出版|雑誌/i,
    "新聞図書費",
  ],
  [/udemy|ﾕｰﾃﾞﾐｰ|schoo|ｾﾐﾅｰ|ｽｸｰﾙ|研修|講座|ﾄﾚｰﾆﾝｸﾞ/i, "研修費"],
  [
    /paypal|stripe|ｽﾄﾗｲﾌﾟ|square|ｽｸｴｱ|shopify|\bbase\b|ﾍﾞｲｽ|振込手数料|手数料|ﾒﾙｶﾘ|ﾍﾟｲﾊﾟﾙ|決済/i,
    "支払手数料",
  ],
  [
    /ｱﾏｿﾞﾝ|amazon|ﾖﾄﾞﾊﾞｼ|ﾋﾞｯｸ|bic\s?camera|ASKUL|ｱｽｸﾙ|ﾓﾉﾀﾛｳ|monotaro|ﾛﾌﾄ|LOFT|ﾊﾝｽﾞ|ﾀﾞｲｿｰ|ｾﾘｱ|無印|ｺｸﾖ|ｽﾃｰｼｮﾅﾘｰ|文具|事務用品/i,
    "消耗品費",
  ],
  [/電力|でんき|東京ｶﾞｽ|大阪ｶﾞｽ|ｶﾞｽ|水道|ｴﾈｵｽでんき/i, "水道光熱費"],
  [
    /ｽﾀｰﾊﾞ|ｽﾀﾊﾞ|starbucks|ﾄﾞﾄｰﾙ|ﾀﾘｰｽﾞ|ｺﾒﾀﾞ|ﾍﾞﾛｰﾁｪ|ｴｸｾﾙｼｵｰﾙ|ｶﾌｪ|珈琲|喫茶|ｺｰﾋｰ/i,
    "会議費",
  ],
  [/損保|海上日動|損保ｼﾞｬﾊﾟﾝ|あいおい|三井住友海上|生命|共済|保険/i, "保険料"],
  [/商工会議所|協会|組合|ｷﾞﾙﾄﾞ|年会費|会費/i, "諸会費"],
];

// Gemini へ渡す分類ガイド（classify.mjs の CLASSIFY_GUIDE を移植）
var CLASSIFY_GUIDE = [
  "あなたは日本の会計・簿記のプロです。クレジットカード(楽天カード)の利用明細を、適切な勘定科目に分類してください。",
  "科目候補（この中から1つ。「未分類」は使わない）: " + CATEGORIES.join(" / "),
  "店名は半角カナの略称が多い。フルネーム・業種を推測すること（例: ｽﾀﾊﾞ→スターバックス, ｱﾏｿﾞﾝ→Amazon, ｳｲｽﾞ→WITH）。",
  "判断基準（会計実務）:",
  "- 打ち合わせ・会議のカフェ/飲食で1人1万円以下 → 会議費。1人1万円超や取引先接待・贈答 → 接待交際費。",
  "- 物品購入(10万円未満) → 消耗品費。10万円以上の物品 → 「要確認」(固定資産の可能性)。",
  "- クラウド/SaaS/AIツール/通信(AWS,Google,Slack,ChatGPT等) → 通信費。決済・取引プラットフォーム手数料 → 支払手数料。",
  "- 書籍・新聞・技術コンテンツ → 新聞図書費。講座・セミナー → 研修費。",
  "- 電車/バス/タクシー/航空 → 旅費交通費。ガソリン/ETC/駐車 → 車両費。配送 → 荷造運賃。",
  "- 電気/ガス/水道 → 水道光熱費。保険 → 保険料。会費 → 諸会費。",
  "- 「雑費」は最小限に。事業性が不明・私的利用の疑い・高額で判断不能なものは「要確認」にする(雑費に逃げない)。",
  "各明細の index と category を返す。",
].join("\n");

// ─── ヘルパー ─────────────────────────────────────────────────────────────────────

/**
 * "YYYY/MM/DD" → "YYYY-MM-DD"
 * @param {string} s
 * @returns {string}
 */
function normalizeDate_(s) {
  return s.replace(/\//g, "-");
}

/**
 * "140" / "1,234" などのカンマ・「円」・空白を除去して整数に変換
 * @param {string} s
 * @returns {number}
 */
function parseAmount_(s) {
  return parseInt(s.replace(/[,，円\s]/g, ""), 10) || 0;
}

/**
 * Gmail ラベルを取得（存在しない場合は作成）
 * @param {string} name
 * @returns {GoogleAppsScript.Gmail.GmailLabel}
 */
function getOrCreateLabel_(name) {
  var label = GmailApp.getUserLabelByName(name);
  if (!label) {
    label = GmailApp.createLabel(name);
    Logger.log("Gmail ラベルを作成しました: " + name);
  }
  return label;
}

/**
 * expenses シートを返す。スプレッドシート ID は Script Property SPREADSHEET_ID、無ければ定数
 * @returns {GoogleAppsScript.Spreadsheet.Sheet}
 */
function getExpensesSheet_() {
  var id =
    PropertiesService.getScriptProperties().getProperty("SPREADSHEET_ID") ||
    SPREADSHEET_ID;
  if (!id) throw new Error("SPREADSHEET_ID が未設定です。");
  var ss = SpreadsheetApp.openById(id);
  var sheet = ss.getSheetByName("expenses");
  if (!sheet)
    throw new Error('スプレッドシートに "expenses" シートが見つかりません。');
  return sheet;
}

// ─── メール本文パース ──────────────────────────────────────────────────────────────

/**
 * 確定版メール本文から取引リストを抽出する。
 * 1通に複数取引が含まれる場合（■利用日が複数回出現）もすべて抽出する。
 * 速報版（■利用先: が無いブロック）は自動的に除外される。
 *
 * @param {string} body  getPlainBody() の返り値
 * @returns {{ date: string, merchant: string, amount: number }[]}
 */
function parseTransactions_(body) {
  var results = [];
  var current = null;
  var lines = body.split(/\r?\n/);

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();

    // 利用日 → 新しいブロック開始
    var dateMatch = line.match(/^■利用日[:：]\s*(\d{4}\/\d{2}\/\d{2})/);
    if (dateMatch) {
      current = { date: normalizeDate_(dateMatch[1]), merchant: "", amount: 0 };
      continue;
    }

    // 利用先
    var merchantMatch = line.match(/^■利用先[:：]\s*(.+)/);
    if (merchantMatch && current) {
      current.merchant = merchantMatch[1].trim();
      continue;
    }

    // 利用金額 → ブロック確定。merchant がある（確定版）場合のみ push
    var amountMatch = line.match(/^■利用金額[:：]\s*([\d,，]+)\s*円/);
    if (amountMatch && current) {
      current.amount = parseAmount_(amountMatch[1]);
      if (current.merchant) {
        results.push(current);
      }
      current = null;
    }
  }

  return results;
}

/**
 * 速報版メール本文から利用日・金額をすべて抽出する。
 * 同日同額の明細も別取引として保持する。
 *
 * @param {string} body getPlainBody() の返り値
 * @returns {{ date: string, amount: number }[]}
 */
function parsePreliminaryTransactions_(body) {
  var results = [];
  var lines = body.split(/\r?\n/);

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    var match = line.match(/^(\d{4}\/\d{2}\/\d{2})\s+\S+\s+([\d,，]+)\s*円$/);
    if (!match) continue;
    results.push({
      date: normalizeDate_(match[1]),
      amount: parseAmount_(match[2]),
    });
  }

  return results;
}

/** 確定明細の同一判定キー（日付・利用先・金額）。 */
function confirmedKey_(transaction) {
  return (
    transaction.date +
    "|" +
    transaction.merchant +
    "|" +
    String(transaction.amount)
  );
}

/** 速報明細の同一判定キー（日付・金額）。速報には利用先が無いので、確定との突き合わせにも使う。 */
function preliminaryKey_(transaction) {
  return transaction.date + "|" + String(transaction.amount);
}

/**
 * 既存行と今回のメール明細から、更新・追加が必要な処理だけを計画する。
 * 件数で比較するため、同日・同利用先・同額の重複明細も失わない。
 *
 * @param {Array[]} existingRows expenses のヘッダーを除く既存行
 * @param {{ date: string, merchant: string, amount: number }[]} confirmedTransactions
 * @param {{ date: string, amount: number }[]} preliminaryTransactions
 * @returns {{
 *   confirmedUpdates: { dataIndex: number, transaction: Object }[],
 *   confirmedInserts: Object[],
 *   preliminaryInserts: Object[]
 * }}
 */
function planExpenseImports_(
  existingRows,
  confirmedTransactions,
  preliminaryTransactions,
) {
  // 既存行を集計する。pendingIndices は確定待ちの速報行の位置、
  // existingConfirmedCounts / existingResolvedAmountCounts は取込済みの確定行の件数。
  var existingConfirmedCounts = {};
  var existingResolvedAmountCounts = {};
  var pendingIndices = {};

  for (var r = 0; r < existingRows.length; r++) {
    var row = existingRows[r];
    var rowTx = {
      date: String(row[1]),
      merchant: String(row[2]),
      amount: Number(row[3]),
    };
    if (String(row[5]) === PRELIMINARY_SOURCE) {
      var pendingKey = preliminaryKey_(rowTx);
      pendingIndices[pendingKey] = (pendingIndices[pendingKey] || []).concat([
        r,
      ]);
    } else if (String(row[5]) === "楽天メール") {
      var confirmedKey = confirmedKey_(rowTx);
      existingConfirmedCounts[confirmedKey] =
        (existingConfirmedCounts[confirmedKey] || 0) + 1;
      var resolvedAmountKey = preliminaryKey_(rowTx);
      existingResolvedAmountCounts[resolvedAmountKey] =
        (existingResolvedAmountCounts[resolvedAmountKey] || 0) + 1;
    }
  }

  // 確定明細: 取込済みならスキップ、同日同額の速報行があれば置換、無ければ追加
  var confirmedSeen = {};
  var pendingUsed = {};
  var confirmedUpdates = [];
  var confirmedInserts = [];

  for (var c = 0; c < confirmedTransactions.length; c++) {
    var tx = confirmedTransactions[c];
    var exactKey = confirmedKey_(tx);
    var occurrence = confirmedSeen[exactKey] || 0;
    confirmedSeen[exactKey] = occurrence + 1;

    if (occurrence < (existingConfirmedCounts[exactKey] || 0)) continue;

    var amountKey = preliminaryKey_(tx);
    var used = pendingUsed[amountKey] || 0;
    var candidates = pendingIndices[amountKey] || [];
    if (used < candidates.length) {
      confirmedUpdates.push({ dataIndex: candidates[used], transaction: tx });
      pendingUsed[amountKey] = used + 1;
    } else {
      confirmedInserts.push(tx);
    }
  }

  // 速報明細: 同日同額の行（速報・確定とも）が既にある件数を超えた分だけ追加
  var preliminarySeen = {};
  var preliminaryInserts = [];
  for (var p = 0; p < preliminaryTransactions.length; p++) {
    var preliminary = preliminaryTransactions[p];
    var key = preliminaryKey_(preliminary);
    var preliminaryOccurrence = preliminarySeen[key] || 0;
    preliminarySeen[key] = preliminaryOccurrence + 1;
    var existingAmountCount =
      (pendingIndices[key] || []).length +
      (existingResolvedAmountCounts[key] || 0);
    if (preliminaryOccurrence >= existingAmountCount) {
      preliminaryInserts.push(preliminary);
    }
  }

  return {
    confirmedUpdates: confirmedUpdates,
    confirmedInserts: confirmedInserts,
    preliminaryInserts: preliminaryInserts,
  };
}

// ─── 費目分類 ─────────────────────────────────────────────────────────────────────

/**
 * 自己学習辞書(merchant_rules シート)を { 正規化キー: 費目 } で読み込む。
 * normalizeMerchant_ は reports.gs に定義（同一プロジェクトでグローバル共有）。
 * @returns {Object}
 */
function loadLearnedMap_() {
  var map = {};
  try {
    var id =
      PropertiesService.getScriptProperties().getProperty("SPREADSHEET_ID") ||
      SPREADSHEET_ID;
    var sh = SpreadsheetApp.openById(id).getSheetByName("merchant_rules");
    if (!sh) return map;
    var last = sh.getLastRow();
    if (last < 2) return map;
    var data = sh.getRange(2, 1, last - 1, 3).getValues(); // key, sampleMerchant, category
    for (var i = 0; i < data.length; i++) {
      if (data[i][0] && data[i][2])
        map[String(data[i][0])] = String(data[i][2]);
    }
  } catch (e) {
    Logger.log("merchant_rules 読込スキップ: " + e);
  }
  return map;
}

/**
 * ルール辞書で費目を確定する。一致なしは null を返す。
 * @param {string} merchant
 * @returns {string|null}
 */
function classifyByRule(merchant) {
  for (var i = 0; i < RULES.length; i++) {
    if (RULES[i][0].test(merchant)) return RULES[i][1];
  }
  return null;
}

/**
 * Gemini API（REST）を使って未分類明細をまとめて1リクエストで分類する。
 * 鍵が無い・エラー時は全件「要確認」で返す。
 *
 * @param {{ merchant: string, amount: number }[]} items  未分類の明細
 * @returns {{ merchant: string, amount: number, category: string }[]}
 */
function classifyWithGemini(items) {
  var key =
    PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY");
  var fallback = items.map(function (it) {
    return { merchant: it.merchant, amount: it.amount, category: "要確認" };
  });

  if (!key) {
    Logger.log("GEMINI_API_KEY が未設定のため費目を「要確認」にします。");
    return fallback;
  }

  var url =
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" +
    key;
  var prompt =
    CLASSIFY_GUIDE +
    "\n\n明細:\n" +
    items
      .map(function (it, i) {
        return i + ": " + it.merchant + " ¥" + it.amount;
      })
      .join("\n");

  var requestBody = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            index: { type: "NUMBER" },
            category: { type: "STRING" },
          },
          required: ["index", "category"],
        },
      },
    },
  };

  try {
    var response = UrlFetchApp.fetch(url, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(requestBody),
      muteHttpExceptions: true,
    });

    var code = response.getResponseCode();
    if (code !== 200) {
      Logger.log(
        "Gemini API エラー: HTTP " +
          code +
          " " +
          response.getContentText().slice(0, 300),
      );
      return fallback;
    }

    var result = JSON.parse(response.getContentText());
    var text = result.candidates[0].content.parts[0].text;
    var entries = JSON.parse(text);

    var map = {};
    for (var j = 0; j < entries.length; j++) {
      var e = entries[j];
      map[e.index] =
        CATEGORIES.indexOf(e.category) !== -1 ? e.category : "要確認";
    }

    return items.map(function (it, i) {
      return {
        merchant: it.merchant,
        amount: it.amount,
        category: map[i] !== undefined ? map[i] : "要確認",
      };
    });
  } catch (err) {
    Logger.log("Gemini 呼び出し例外: " + err);
    return fallback;
  }
}

/**
 * 明細配列に category を付与して返す。
 * ルール確定 → 高額未確定 → Gemini → 要確認 の優先順で分類する。
 *
 * @param {{ merchant: string, amount: number }[]} items
 * @returns {{ merchant: string, amount: number, category: string }[]}
 */
function classify(items) {
  var learned = loadLearnedMap_();
  var out = items.map(function (it) {
    // 自己学習辞書を最優先（ユーザー確定の利用先は AI を介さず即確定）。
    var key =
      typeof normalizeMerchant_ === "function"
        ? normalizeMerchant_(it.merchant)
        : it.merchant;
    var cat = learned[key] || classifyByRule(it.merchant);
    return { merchant: it.merchant, amount: it.amount, category: cat };
  });

  // 高額かつルール未確定 → 要確認（固定資産・私的利用の精査対象）
  for (var i = 0; i < out.length; i++) {
    if (!out[i].category && out[i].amount >= 100000) {
      out[i].category = "要確認";
    }
  }

  // Gemini に渡す未確定分を収集
  var unknownIndices = [];
  var unknownItems = [];
  for (var j = 0; j < out.length; j++) {
    if (!out[j].category) {
      unknownIndices.push(j);
      unknownItems.push({ merchant: out[j].merchant, amount: out[j].amount });
    }
  }

  if (unknownItems.length > 0) {
    var classified = classifyWithGemini(unknownItems);
    for (var k = 0; k < unknownIndices.length; k++) {
      out[unknownIndices[k]].category = classified[k].category;
    }
  }

  // null が残っている場合は「要確認」に丸める
  for (var m = 0; m < out.length; m++) {
    if (!out[m].category) out[m].category = "要確認";
  }

  return out;
}

// ─── メイン ───────────────────────────────────────────────────────────────────────

/**
 * 楽天カード速報版・確定版メールを Gmail から取込み、expenses シートへ反映する。
 * 処理済みスレッドには Gmail ラベル "keiri-imported" を付与して再処理を防ぐ。
 */
function importRakutenMail() {
  var sheet = getExpensesSheet_();

  // 既存行を読む。列順: A=id, B=date, C=merchant, D=amount, E=category, F=source, G=note, H=createdAt, I=updatedAt
  var data = [];
  var lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    data = sheet.getRange(2, 1, lastRow - 1, 9).getValues();
  }

  // Gmail 検索（速報版・確定版、未処理のみ、直近60日）
  // in:anywhere = 迷惑メール/ゴミ箱も対象（楽天メールが迷惑メールに入る事故への保険）。
  var query =
    "in:anywhere from:rakuten-card.co.jp subject:カード利用のお知らせ -label:keiri-imported newer_than:60d";
  var threads = GmailApp.search(query);
  Logger.log("検索ヒットスレッド数: " + threads.length);

  var importedLabel = getOrCreateLabel_("keiri-imported");
  var confirmedTransactions = [];
  var preliminaryTransactions = [];

  for (var t = 0; t < threads.length; t++) {
    var messages = threads[t].getMessages();
    for (var m = 0; m < messages.length; m++) {
      var body = messages[m].getPlainBody();
      // 確定版だけに「■利用先」がある
      if (body.indexOf("■利用先") !== -1) {
        confirmedTransactions = confirmedTransactions.concat(
          parseTransactions_(body),
        );
      } else {
        preliminaryTransactions = preliminaryTransactions.concat(
          parsePreliminaryTransactions_(body),
        );
      }
    }
  }

  // 既存行と突き合わせ、置換・追加する分を決める
  var plan = planExpenseImports_(
    data,
    confirmedTransactions,
    preliminaryTransactions,
  );
  // 置換分と追加分の確定明細をまとめて分類する。結果は同じ順序で classifiedIndex から取り出す
  var confirmedWork = plan.confirmedUpdates
    .map(function (item) {
      return item.transaction;
    })
    .concat(plan.confirmedInserts);
  var classified = classify(
    confirmedWork.map(function (tx) {
      return { merchant: tx.merchant, amount: tx.amount };
    }),
  );
  var now = new Date().toISOString();
  var classifiedIndex = 0;

  for (var u = 0; u < plan.confirmedUpdates.length; u++) {
    var update = plan.confirmedUpdates[u];
    var original = data[update.dataIndex];
    var updateClass = classified[classifiedIndex++];
    sheet
      .getRange(update.dataIndex + 2, 1, 1, 9)
      .setValues([
        [
          original[0],
          update.transaction.date,
          update.transaction.merchant,
          String(update.transaction.amount),
          updateClass.category,
          "楽天メール",
          "",
          original[7] || now,
          now,
        ],
      ]);
  }

  var newRows = [];
  for (var n = 0; n < plan.confirmedInserts.length; n++) {
    var confirmed = plan.confirmedInserts[n];
    var insertClass = classified[classifiedIndex++];
    newRows.push([
      Utilities.getUuid(),
      confirmed.date,
      confirmed.merchant,
      String(confirmed.amount),
      insertClass.category,
      "楽天メール",
      "",
      now,
      now,
    ]);
  }

  for (var p = 0; p < plan.preliminaryInserts.length; p++) {
    var preliminary = plan.preliminaryInserts[p];
    newRows.push([
      Utilities.getUuid(),
      preliminary.date,
      PRELIMINARY_MERCHANT,
      String(preliminary.amount),
      "要確認",
      PRELIMINARY_SOURCE,
      PRELIMINARY_NOTE,
      now,
      now,
    ]);
  }

  if (newRows.length > 0) {
    sheet
      .getRange(sheet.getLastRow() + 1, 1, newRows.length, 9)
      .setValues(newRows);
  }

  // シート反映がすべて成功してからラベルを付ける。途中失敗時は再実行で復旧できる。
  for (var labelIndex = 0; labelIndex < threads.length; labelIndex++) {
    try {
      threads[labelIndex].addLabel(importedLabel);
    } catch (labelErr) {
      Logger.log("ラベル付与エラー (thread): " + labelErr);
    }
  }

  Logger.log(
    "取込完了: 確定更新 " +
      plan.confirmedUpdates.length +
      " 件 / 確定追加 " +
      plan.confirmedInserts.length +
      " 件 / 速報追加 " +
      plan.preliminaryInserts.length +
      " 件",
  );
}

// ─── 診断 ─────────────────────────────────────────────────────────────────────────

/**
 * この受信箱に楽天系メールが届いているかを調べる診断用関数。
 * 各検索のヒット数と、件名・差出人のサンプルを実行ログに出す。
 * （取込はしない。状況把握のためだけに一度実行する。）
 */
function diagnoseRakutenMail() {
  var queries = [
    "from:rakuten-card.co.jp newer_than:180d",
    "from:mail.rakuten-card.co.jp newer_than:180d",
    "subject:カード利用のお知らせ newer_than:180d",
    "楽天カード newer_than:180d",
    "rakuten newer_than:365d",
  ];

  for (var q = 0; q < queries.length; q++) {
    var threads = GmailApp.search(queries[q], 0, 5);
    Logger.log("--- [" + queries[q] + "] ヒット: " + threads.length + " ---");
    for (var t = 0; t < threads.length; t++) {
      var msg = threads[t].getMessages()[0];
      Logger.log("  差出人: " + msg.getFrom() + " / 件名: " + msg.getSubject());
    }
  }
  Logger.log(
    "診断完了。ヒットしたメールの差出人ドメイン・件名を確認してください。",
  );
}

/**
 * 確定版「カード利用のお知らせ」メールの本文（プレーンテキスト）を実行ログに出す。
 * 実際の本文フォーマットに合わせてパーサを作るための調査用。取込はしない。
 */
function dumpLatestRakutenMail() {
  var query =
    "in:anywhere from:rakuten-card.co.jp subject:カード利用のお知らせ -速報版 newer_than:120d";
  var threads = GmailApp.search(query, 0, 3);
  Logger.log("ヒット: " + threads.length);
  if (threads.length === 0) {
    Logger.log(
      "確定版メールが見つかりません。subject に 速報版 が無いものだけ対象です。",
    );
    return;
  }
  var msg = threads[0].getMessages()[0];
  Logger.log("差出人: " + msg.getFrom());
  Logger.log("件名: " + msg.getSubject());
  var body = msg.getPlainBody();
  Logger.log("本文文字数: " + body.length);
  Logger.log("===== PLAIN BODY START =====");
  // 1ログの上限対策で分割出力
  for (var i = 0; i < body.length; i += 1800) {
    Logger.log(body.substring(i, i + 1800));
  }
  Logger.log("===== PLAIN BODY END =====");
}

// ─── トリガー管理 ─────────────────────────────────────────────────────────────────

/**
 * importRakutenMail の 1 時間ごとのトリガーを設定する（冪等）。
 * 既存の同名トリガーを削除してから新規作成する。
 * 一度だけ手動実行すること。
 */
function setupTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === "importRakutenMail") {
      ScriptApp.deleteTrigger(triggers[i]);
      Logger.log("既存トリガーを削除しました。");
    }
  }

  ScriptApp.newTrigger("importRakutenMail").timeBased().everyHours(1).create();

  Logger.log("トリガーを設定しました: importRakutenMail を 1 時間ごとに実行。");
}
