import { GoogleGenAI, Type } from "@google/genai";
import { getRepositories } from "@/repositories";
import { companyScope, loadCompanyContext } from "@/lib/active-company";
import { hasGeminiConfig, requireGeminiKey } from "@/lib/config";
import { summarize } from "@/domain/money";
import { monthlySeries } from "@/domain/finance";
import { recentMonths, toIsoDate } from "@/domain/dates";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  if (!hasGeminiConfig()) {
    return Response.json(
      { error: "GEMINI_API_KEY が未設定のため AI 提案を利用できません" },
      { status: 503 },
    );
  }

  const repos = await getRepositories();
  const scope = companyScope(await loadCompanyContext(repos));
  const [expenses, documents] = await Promise.all([
    repos.expenses.list(scope),
    repos.documents.list(scope),
  ]);

  const months = recentMonths(12);
  const series = monthlySeries(expenses, documents, months);

  // 費目別支出合計
  const categoryTotals = new Map<string, number>();
  for (const e of expenses) {
    categoryTotals.set(
      e.category,
      (categoryTotals.get(e.category) ?? 0) + e.amount,
    );
  }

  const totalExpense = expenses.reduce((s, e) => s + e.amount, 0);

  const now = new Date();
  const yearStr = String(now.getFullYear());
  const todayStr = toIsoDate(now);

  const isYtd = (dateStr: string): boolean =>
    dateStr >= `${yearStr}-01-01` && dateStr <= todayStr;

  const ytdRevenue = documents
    .filter(
      (inv) =>
        inv.type === "invoice" &&
        (inv.status === "issued" ||
          inv.status === "sent" ||
          inv.status === "paid") &&
        isYtd(inv.issueDate),
    )
    .reduce((sum, inv) => sum + summarize(inv.items).total, 0);

  const ytdExpense = expenses
    .filter((e) => isYtd(e.date))
    .reduce((sum, e) => sum + e.amount, 0);

  const ytdProfit = ytdRevenue - ytdExpense;

  const categoryList = [...categoryTotals.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([cat, total]) => `${cat}: ${total.toLocaleString("ja-JP")}円`)
    .join(", ");

  const monthlyTrend = series
    .map(
      (m) =>
        `${m.month}: 収入${m.income.toLocaleString("ja-JP")}円 支出${m.expense.toLocaleString("ja-JP")}円 収支${m.net.toLocaleString("ja-JP")}円`,
    )
    .join("\n");

  const prompt = [
    "あなたは日本の一人法人オーナーの専属CFOです。",
    "以下の財務データを分析し、使途の最適化・サブスク棚卸し・経費化漏れ・節約余地・税金の引当について",
    "具体的かつ短く3〜5件、各1〜2文で提案してください。",
    "",
    "# 財務データ",
    `費目別支出合計: ${categoryList || "データなし"}`,
    `経費合計: ${totalExpense.toLocaleString("ja-JP")}円`,
    `今期 売上: ${ytdRevenue.toLocaleString("ja-JP")}円 / 経費: ${ytdExpense.toLocaleString("ja-JP")}円 / 概算利益: ${ytdProfit.toLocaleString("ja-JP")}円`,
    "",
    "# 月次推移（直近12ヶ月）",
    monthlyTrend,
  ].join("\n");

  const ai = new GoogleGenAI({ apiKey: requireGeminiKey() });

  try {
    const res = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            suggestions: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
          },
          required: ["suggestions"],
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
    const data = JSON.parse(text) as { suggestions: string[] };
    return Response.json(data);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "AI生成に失敗しました";
    return Response.json({ error: message }, { status: 502 });
  }
}
