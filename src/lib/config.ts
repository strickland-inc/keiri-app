/**
 * 任意の外部サービスの API キー。未設定でもアプリは動き、その機能だけが使えなくなる。
 * `KEY=""` と書いた空の値は、未設定として扱う。
 * スプレッドシートへの接続（KEIRI_CONNECTION）は lib/gateway.ts が読む。
 */
function optionalEnv(name: string): string | undefined {
  return process.env[name] || undefined;
}

/** Gemini の API キー。帳票の下書き、レシートの読み取り、改善提案に使う。 */
export function hasGeminiConfig(): boolean {
  return Boolean(optionalEnv("GEMINI_API_KEY"));
}

export function requireGeminiKey(): string {
  const key = optionalEnv("GEMINI_API_KEY");
  if (!key) throw new Error("GEMINI_API_KEY が未設定です");
  return key;
}

/** TypeSafe（Jev）の設定。銀行明細の科目を自動で決めるのに使う。 */
export function getTypesafeConfig(): { apiKey?: string; model?: string } {
  return {
    apiKey: optionalEnv("TYPESAFE_API_KEY"),
    model: optionalEnv("TYPESAFE_MODEL"),
  };
}
