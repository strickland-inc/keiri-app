"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createFirstAdmin as createAdmin } from "@/lib/auth-server";
import { startSession } from "@/lib/session";
import { firstIssue, pickValues, type FormState } from "@/app/login/form-state";

const schema = z.object({
  connectionCode: z
    .string()
    .trim()
    .min(1, "接続コードを入れてください")
    .max(2000, "接続コードが長すぎます"),
  loginId: z
    .string()
    .trim()
    .min(3, "ログイン ID は 3 文字以上にしてください")
    .max(64, "ログイン ID は 64 文字以内にしてください"),
  displayName: z
    .string()
    .trim()
    .min(1, "表示名を入れてください")
    .max(50, "表示名は 50 文字以内にしてください"),
  password: z
    .string()
    .min(1, "パスワードを入れてください")
    .max(200, "パスワードは 200 文字以内にしてください"),
  confirm: z.string(),
});

/**
 * 最初の管理者を作る。ユーザーが 1 人もいないときだけ通る。
 * アプリの URL を知っているだけの人に先を越されないよう、スプレッドシートの持ち主だけが
 * 知っている接続コードで、持ち主かどうかを確かめる（確かめるのは core の createFirstAdmin）。
 */
export async function createFirstAdmin(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = pickValues(formData, ["loginId", "displayName"]);
  const parsed = schema.safeParse({
    connectionCode: formData.get("connectionCode"),
    loginId: formData.get("loginId"),
    displayName: formData.get("displayName"),
    password: formData.get("password"),
    confirm: formData.get("confirm"),
  });
  if (!parsed.success) return { error: firstIssue(parsed.error), values };
  if (parsed.data.password !== parsed.data.confirm) {
    return { error: "確認用のパスワードが一致しません", values };
  }

  const result = await createAdmin({
    connectionCode: parsed.data.connectionCode,
    loginId: parsed.data.loginId,
    displayName: parsed.data.displayName,
    password: parsed.data.password,
  });
  if (!result.ok) return { error: result.error, values };

  await startSession(result.value.userId);
  redirect("/");
}
