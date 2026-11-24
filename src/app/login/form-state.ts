/** 未ログインの画面のフォームが返す状態。パスワードは入れない（入力を戻すのは、パスワード以外だけ）。 */
export interface FormState {
  error?: string;
  values?: Record<string, string>;
}

/** FormData から、パスワード以外の入力を文字列で取り出す。 */
export function pickValues(
  formData: FormData,
  names: readonly string[],
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const name of names) {
    const raw = formData.get(name);
    values[name] = typeof raw === "string" ? raw : "";
  }
  return values;
}

/** zod の検査で最初に見つかった指摘を、画面に出す文言にする。 */
export function firstIssue(error: {
  issues: ReadonlyArray<{ message: string }>;
}): string {
  return error.issues[0]?.message ?? "入力を確かめてください";
}
