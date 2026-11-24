"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { clientIp, recoverAdmin } from "@/lib/auth-server";
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
    .min(1, "管理者のログイン ID を入れてください")
    .max(64, "ログイン ID は 64 文字以内にしてください"),
  password: z
    .string()
    .min(1, "パスワードを入れてください")
    .max(200, "パスワードは 200 文字以内にしてください"),
  confirm: z.string(),
});

/** 管理者の復旧。接続コードで持ち主だと確かめ、管理者のパスワードを入れ替える（確かめるのは core の recoverAdmin）。 */
export async function recoverAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = pickValues(formData, ["loginId"]);
  const parsed = schema.safeParse({
    connectionCode: formData.get("connectionCode"),
    loginId: formData.get("loginId"),
    password: formData.get("password"),
    confirm: formData.get("confirm"),
  });
  if (!parsed.success) return { error: firstIssue(parsed.error), values };
  if (parsed.data.password !== parsed.data.confirm) {
    return { error: "確認用のパスワードが一致しません", values };
  }

  const result = await recoverAdmin(
    {
      connectionCode: parsed.data.connectionCode,
      loginId: parsed.data.loginId,
      password: parsed.data.password,
    },
    await clientIp(),
  );
  if (!result.ok) return { error: result.error, values };
  redirect("/login?recovered=1");
}
