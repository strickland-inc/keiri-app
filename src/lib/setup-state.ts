import { GatewayError } from "@/lib/gateway";
import { getRepositories } from "@/repositories";

/**
 * 登録済みのユーザーの数。スプレッドシートに届かないときは、その理由を返す。
 * 本番では画面の例外の文言が定型文に置き換わるので、設定の誤りをここで文言にして画面に出す。
 */
export async function countUsers(): Promise<
  { ok: true; count: number } | { ok: false; message: string }
> {
  try {
    const repos = await getRepositories();
    return { ok: true, count: (await repos.users.list()).length };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof GatewayError
          ? error.message
          : "スプレッドシートに接続できませんでした。接続コードとウェブアプリの設定を確かめてください",
    };
  }
}
