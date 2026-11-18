/**
 * 経費の費目（勘定科目）分類ロジック。会計実務ベース。
 * 安定・低コストのため「決定論ルール辞書」で大半を確定し、残りだけ AI(Gemini) で補完する。
 * 分類基準の正＝ .claude/skills/expense-classification/SKILL.md（このファイルはその実装）。
 */
import { GoogleGenAI, Type } from "@google/genai";

// src/domain/expense.ts の EXPENSE_CATEGORIES と一致させること（手動同期）。
export const CATEGORIES = [
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

// 確定ルール（店名の正規表現→科目）。半角カナ・英字・全角に対応。先頭から最初に一致したものを採用。
export const RULES = [
  [
    /JR|新幹線|ＥＸ|EX予約|ｽｲｶ|SUICA|ICOCA|PASMO|ﾊﾟｽﾓ|ﾒﾄﾛ|メトロ|地下鉄|都営|京急|東急|小田急|西武|京王|ﾊﾞｽ|ﾀｸｼｰ|タクシー|\bGO\b|DiDi|S\.RIDE|ANA|JAL|航空|空港|鉄道|新幹線/i,
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

export function classifyByRule(merchant) {
  for (const [re, cat] of RULES) if (re.test(merchant)) return cat;
  return null;
}

// 利用先の表記ゆれ正規化（src/domain/reports.ts の normalizeMerchant と一致させること）。
// 自己学習辞書(merchant_rules)のキー算出に使う。
const CARD_PREFIXES = [
  "ＶＩＳＡ国内利用　VS ",
  "ＪＣＢ国内利用　QP ",
  "ＶＩＳＡ海外利用　",
];
export function normalizeMerchant(raw) {
  let s = raw ?? "";
  for (const p of CARD_PREFIXES) {
    if (s.startsWith(p)) {
      s = s.slice(p.length);
      break;
    }
  }
  s = s.replace(/利用国[A-Z]{2}$/, "");
  s = s.replace(/[\d\s]+$/, "");
  s = s.replace(/　/g, " ");
  s = s.replace(/\s+/g, " ");
  s = s.trim();
  return s === "" ? (raw ?? "") : s;
}

// AI に渡す判断基準（会計実務ベース。Skill と同じ基準）。
export const CLASSIFY_GUIDE = [
  "あなたは日本の会計・簿記のプロです。クレジットカード(楽天カード)の利用明細を、適切な勘定科目に分類してください。",
  `科目候補（この中から1つ。「未分類」は使わない）: ${CATEGORIES.join(" / ")}`,
  "店名は半角カナの略称が多い。フルネーム・業種を推測すること（例: ｽﾀﾊﾞ→スターバックス, ｱﾏｿﾞﾝ→Amazon, ｳｲｽﾞ→WITH）。",
  "判断基準（会計実務）:",
  "- 打ち合わせ・会議のカフェ/飲食で1人1万円以下 → 会議費。1人1万円超や取引先接待・贈答 → 接待交際費。",
  "- 物品購入(10万円未満) → 消耗品費。10万円以上の物品 → 『要確認』(固定資産の可能性)。",
  "- クラウド/SaaS/AIツール/通信(AWS,Google,Slack,ChatGPT等) → 通信費。決済・取引プラットフォーム手数料 → 支払手数料。",
  "- 書籍・新聞・技術コンテンツ → 新聞図書費。講座・セミナー → 研修費。",
  "- 電車/バス/タクシー/航空 → 旅費交通費。ガソリン/ETC/駐車 → 車両費。配送 → 荷造運賃。",
  "- 電気/ガス/水道 → 水道光熱費。保険 → 保険料。会費 → 諸会費。",
  "- 『雑費』は最小限に。事業性が不明・私的利用の疑い・高額で判断不能なものは『要確認』にする(雑費に逃げない)。",
  "各明細の index と category を返す。",
].join("\n");

/**
 * 明細配列に category を付与して返す。
 * 優先順: 自己学習辞書(learnedMap) → ルール辞書 → 高額(10万円)→要確認 → Gemini → 要確認。
 * learnedMap は { 正規化利用先キー: 費目 }（ユーザーが確定した利用先。AI を介さず即確定する）。
 * @param {{merchant:string, amount:number}[]} items
 * @param {string|undefined} geminiKey
 * @param {Record<string,string>} [learnedMap]
 */
export async function classify(items, geminiKey, learnedMap = {}) {
  const out = items.map((it) => {
    const learned = learnedMap[normalizeMerchant(it.merchant)];
    return { ...it, category: learned ?? classifyByRule(it.merchant) };
  });

  // 高額でルール未確定 → 要確認（固定資産・私的利用の精査対象）
  for (const r of out)
    if (!r.category && r.amount >= 100000) r.category = "要確認";

  const unknown = out.filter((r) => !r.category);
  // AI を呼べない（未分類なし、または API キーなし）場合は未確定を要確認にして返す
  if (unknown.length === 0 || !geminiKey) {
    return out.map((r) => ({ ...r, category: r.category ?? "要確認" }));
  }

  const ai = new GoogleGenAI({ apiKey: geminiKey });
  const prompt =
    CLASSIFY_GUIDE +
    "\n\n明細:\n" +
    unknown.map((it, i) => `${i}: ${it.merchant} ¥${it.amount}`).join("\n");
  const res = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            index: { type: Type.NUMBER },
            category: { type: Type.STRING },
          },
          required: ["index", "category"],
        },
      },
    },
  });

  // AI の index は unknown 内の位置。科目候補に無い回答は要確認に落とす
  const aiCategories = new Map();
  for (const e of JSON.parse(res.text ?? "[]")) {
    aiCategories.set(
      e.index,
      CATEGORIES.includes(e.category) ? e.category : "要確認",
    );
  }

  let unknownIndex = 0;
  return out.map((r) =>
    r.category
      ? r
      : { ...r, category: aiCategories.get(unknownIndex++) ?? "要確認" },
  );
}
