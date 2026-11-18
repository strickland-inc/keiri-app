import type { NextRequest } from "next/server";
import { GoogleGenAI, Type } from "@google/genai";
import { hasGeminiConfig, requireGeminiKey } from "@/lib/config";
import { EXPENSE_CATEGORIES } from "@/domain/expense";

export const runtime = "nodejs";

export async function POST(req: NextRequest): Promise<Response> {
  if (!hasGeminiConfig()) {
    return Response.json(
      { error: "GEMINI_API_KEY が未設定です" },
      { status: 400 },
    );
  }

  let body: { image?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "不正なリクエストです" }, { status: 400 });
  }

  if (typeof body.image !== "string" || !body.image) {
    return Response.json({ error: "image が空です" }, { status: 400 });
  }

  // dataURL の場合は "data:...;base64," 接頭辞を剥がす
  const raw = body.image.includes(",") ? body.image.split(",")[1] : body.image;

  const ai = new GoogleGenAI({ apiKey: requireGeminiKey() });

  const categoriesList = EXPENSE_CATEGORIES.join("、");
  const prompt = [
    "日本の領収書またはレシートを解析してください。",
    "以下の情報を抽出してJSON形式で返してください。",
    "- found: 領収書として日付と金額が読み取れたか（boolean）",
    "- date: 発行日（YYYY-MM-DD形式。不明なら空文字）",
    "- merchant: 店名または発行者名（不明なら空文字）",
    "- amount: 合計金額（税込・円・整数）。割引後の最終支払額を使用。読み取れない場合は0。",
    "- category: 費目。次の選択肢から最も適切なものを選ぶ: " + categoriesList,
    "- confidence: 読み取り信頼度（0〜1）",
    "",
    "注意事項:",
    "- 日付・合計金額のどちらかが読み取れない場合は found=false にする。",
    "- 金額は税込合計金額（最終支払額）を使用する。小計や税抜き金額は使わない。",
    "- 領収書・レシート以外の画像（風景、人物など）は found=false にする。",
  ].join("\n");

  try {
    const res = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          parts: [
            { inlineData: { mimeType: "image/jpeg", data: raw } },
            { text: prompt },
          ],
        },
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            found: { type: Type.BOOLEAN },
            date: { type: Type.STRING },
            merchant: { type: Type.STRING },
            amount: { type: Type.NUMBER },
            category: { type: Type.STRING },
            confidence: { type: Type.NUMBER },
          },
          required: [
            "found",
            "date",
            "merchant",
            "amount",
            "category",
            "confidence",
          ],
        },
      },
    });

    const text = res.text;
    if (!text) {
      return Response.json(
        { error: "AIから空の応答が返りました" },
        { status: 502 },
      );
    }
    return Response.json(JSON.parse(text));
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "AI解析に失敗しました";
    return Response.json({ error: message }, { status: 502 });
  }
}
