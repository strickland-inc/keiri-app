"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { constantTimeEqual, hashPassword } from "@/lib/auth-server";
import { getRepositories } from "@/repositories";
import { startSession } from "@/lib/session";

export interface SetupState {
  error?: string;
  loginId?: string;
}

const schema = z.object({
  connectionCode: z.string().trim().min(1, "接続コードを入れてください"),
  loginId: z
    .string()
    .trim()
    .min(3, "ログイン ID は 3 文字以上にしてください")
    .max(64, "ログイン ID は 64 文字以内にしてください"),
  password: z
    .string()
    .min(12, "パスワードは 12 文字以上にしてください")
    .max(200, "パスワードは 200 文字以内にしてください"),
});

/**
 * 最初の管理者を作る。ユーザーが 1 人もいないときだけ通る。
 * アプリの URL を知っているだけの人に先を越されないよう、スプレッドシートの持ち主だけが
 * 知っている接続コードを入れてもらい、設定済みの値と一致するかを確かめる。
 */
export async function createFirstAdmin(
  _prev: SetupState,
  formData: FormData,
): Promise<SetupState> {
  const parsed = schema.safeParse({
    connectionCode: formData.get("connectionCode"),
    loginId: formData.get("loginId"),
    password: formData.get("password"),
  });
  const loginId = String(formData.get("loginId") ?? "");
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message, loginId };
  }

  const expected = (process.env.KEIRI_CONNECTION ?? "").trim();
  if (!expected || !constantTimeEqual(parsed.data.connectionCode, expected)) {
    return {
      error:
        "接続コードが違います。アプリに設定したものと同じ接続コードを入れてください",
      loginId,
    };
  }

  const repos = await getRepositories();
  if ((await repos.users.list()).length > 0) redirect("/login");

  const user = await repos.users.create({
    loginId: parsed.data.loginId,
    passwordHash: await hashPassword(parsed.data.password),
    role: "admin",
  });
  await startSession(user.id, user.role);
  redirect("/");
}
