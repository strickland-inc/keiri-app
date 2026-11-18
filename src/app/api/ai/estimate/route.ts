import type { NextRequest } from "next/server";
import { GoogleGenAI, Type } from "@google/genai";
import { hasGeminiConfig, requireGeminiKey } from "@/lib/config";
import {
  DOCUMENT_TYPE_LABELS,
  isDocumentType,
  type DocumentType,
} from "@/domain/documents";

export const runtime = "nodejs";

/**
 * 案件概要から見積もり/請求のたたき台（件名・明細・備考）を Gemini で生成する。
 * あくまでドラフト。ユーザーがフォーム上で調整して確定する前提。
 */
export async function POST(req: NextRequest): Promise<Response> {
  if (!hasGeminiConfig()) {
    return Response.json(
      { error: "GEMINI_API_KEY が未設定です" },
      { status: 400 },
    );
  }

  let body: { description?: unknown; documentType?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "不正なリクエストです" }, { status: 400 });
  }

  const description =
    typeof body.description === "string" ? body.description.trim() : "";
  if (!description) {
    return Response.json({ error: "案件概要が空です" }, { status: 400 });
  }
  const documentType: DocumentType =
    typeof body.documentType === "string" && isDocumentType(body.documentType)
      ? body.documentType
      : "quote";

  const ai = new GoogleGenAI({ apiKey: requireGeminiKey() });

  const prompt = [
    `あなたは日本の中小企業・個人事業の経理アシスタントです。`,
    `次の案件概要から、${DOCUMENT_TYPE_LABELS[documentType]}のたたき台を作成してください。`,
    ``,
    `# 案件概要`,
    description,
    ``,
    `# ルール`,
    `- 金額はすべて「円・税抜・整数」。一般的な日本の相場感で概算してよい（後で人が調整する前提）。`,
    `- taxRate は 0.1（標準）を基本に。軽減税率対象（飲食料品・新聞）は 0.08、非課税は 0。`,
    `- 明細は具体的な作業/品目に分解する（例：要件定義、設計、実装、テスト、保守 など）。`,
    `- unit は「式」「件」「時間」「ヶ月」など適切に。quantity は数量。`,
    `- title は簡潔な件名。notes は補足があれば（無ければ空文字）。`,
    `- 不明な点は一般的な仮定を置き、それを notes に短く記す。`,
  ].join("\n");

  try {
    const res = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            items: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  name: { type: Type.STRING },
                  quantity: { type: Type.NUMBER },
                  unit: { type: Type.STRING },
                  unitPrice: { type: Type.NUMBER },
                  taxRate: { type: Type.NUMBER },
                },
                required: ["name", "quantity", "unitPrice", "taxRate"],
              },
            },
            notes: { type: Type.STRING },
          },
          required: ["title", "items"],
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
    const data = JSON.parse(text);
    return Response.json(data);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "AI生成に失敗しました";
    return Response.json({ error: message }, { status: 502 });
  }
}
