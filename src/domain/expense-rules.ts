/**
 * カード明細の費目を決める純関数。基準の正は .claude/skills/expense-classification/SKILL.md。
 * 順番は 学習辞書 → ルール辞書 → 金額 → 要確認。Gemini は呼ばない（取込画面を速く、無料で保つため）。
 */
import type { ExpenseCategory } from "./expense";
import { normalizeMerchant } from "./reports.ts";

/** 店名の正規表現 → 費目。半角カナ・英字・全角に対応し、先頭から最初に一致したものを採る（並びを変えると結果が変わる）。 */
export const EXPENSE_RULES: ReadonlyArray<readonly [RegExp, ExpenseCategory]> =
  [
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
    [
      /損保|海上日動|損保ｼﾞｬﾊﾟﾝ|あいおい|三井住友海上|生命|共済|保険/i,
      "保険料",
    ],
    [/商工会議所|協会|組合|ｷﾞﾙﾄﾞ|年会費|会費/i, "諸会費"],
  ];

/** 物品の固定資産（10万円以上）の疑い。ルールに当たらない高額は人が確かめる。 */
export const HIGH_AMOUNT_THRESHOLD = 100_000;

export type ClassifyMethod = "learned" | "rule" | "amount" | "unknown";

export function classifyExpense(
  input: { merchant: string; amount: number },
  learned: ReadonlyMap<string, ExpenseCategory>,
): { category: ExpenseCategory; method: ClassifyMethod } {
  const learnedCategory = learned.get(normalizeMerchant(input.merchant));
  if (learnedCategory) return { category: learnedCategory, method: "learned" };

  for (const [pattern, category] of EXPENSE_RULES) {
    if (pattern.test(input.merchant)) return { category, method: "rule" };
  }

  if (input.amount >= HIGH_AMOUNT_THRESHOLD) {
    return { category: "要確認", method: "amount" };
  }
  return { category: "要確認", method: "unknown" };
}
