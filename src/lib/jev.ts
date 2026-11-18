/**
 * TypeSafe「Jev」（System One モデル）のクライアント。選択式の質問に、選択肢ごとの確率つきで答える。
 * 認証は `TYPESAFE_API_KEY`（Authorization: Bearer）。モデルは `TYPESAFE_MODEL`（既定 jev-latest）。
 * Node ランタイム専用（サーバから呼ぶ）。
 */
import { getConfig } from "./config.ts";

const BASE_URL = "https://api.typesafe.ai";
const TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 2;

export interface JevChoice {
  choice: string;
  /** 選んだ選択肢の確信度 0〜1。 */
  confidence: number;
}

interface ChoiceQuestion {
  instructions: string;
  /** 選択肢名 → いつ当てはまるか。 */
  criteria: Readonly<Record<string, string>>;
}

export class JevError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "JevError";
    this.status = status;
  }
}

function headers(): Record<string, string> {
  const { TYPESAFE_API_KEY } = getConfig();
  return {
    "Content-Type": "application/json",
    ...(TYPESAFE_API_KEY
      ? { Authorization: `Bearer ${TYPESAFE_API_KEY}` }
      : {}),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface SystemOneResponse {
  answers: Record<
    string,
    { type: string; choice?: string; confidence?: number }
  >;
}

/**
 * 1 つの内容（state）に対して、名前付きの選択式の質問をまとめて投げる。
 * 429・5xx・通信失敗は間隔を空けて再試行する。
 */
export async function askJevChoices(
  state: unknown,
  questions: Readonly<Record<string, ChoiceQuestion>>,
): Promise<Record<string, JevChoice>> {
  const body = JSON.stringify({
    model: getConfig().TYPESAFE_MODEL || "jev-latest",
    state,
    questions: Object.fromEntries(
      Object.entries(questions).map(([name, q]) => [
        name,
        { type: "choice", instructions: q.instructions, criteria: q.criteria },
      ]),
    ),
  });

  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(`${BASE_URL}/v1/systemone`, {
        method: "POST",
        headers: headers(),
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.status === 401 || res.status === 403) {
        throw new JevError(
          "Jev の認証に失敗しました。環境変数 TYPESAFE_API_KEY を確認してください",
          res.status,
        );
      }
      if (res.status === 429 || res.status >= 500) {
        throw new JevError(
          `Jev が一時的に応答できません (${res.status})`,
          res.status,
        );
      }
      if (!res.ok) {
        throw new JevError(
          `Jev へのリクエストが不正です (${res.status})`,
          res.status,
        );
      }
      const data = (await res.json()) as SystemOneResponse;
      const result: Record<string, JevChoice> = {};
      for (const [name, answer] of Object.entries(data.answers ?? {})) {
        if (answer.type === "choice" && typeof answer.choice === "string") {
          result[name] = {
            choice: answer.choice,
            confidence: answer.confidence ?? 0,
          };
        }
      }
      return result;
    } catch (e: unknown) {
      lastError = e;
      const retryable =
        !(e instanceof JevError) ||
        e.status === undefined ||
        e.status === 429 ||
        e.status >= 500;
      if (!retryable || attempt === MAX_ATTEMPTS) break;
      await sleep(500 * 2 ** (attempt - 1));
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new JevError("Jev の呼び出しに失敗しました");
}

/** 質問 1 つだけを投げる簡易版。 */
export async function askJevChoice(
  state: unknown,
  question: ChoiceQuestion,
): Promise<JevChoice> {
  const answers = await askJevChoices(state, { q: question });
  const answer = answers.q;
  if (!answer) throw new JevError("Jev から回答が返りませんでした");
  return answer;
}
