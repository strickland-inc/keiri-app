"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { acceptInvite, clientIp, isTotpRequired } from "@/lib/auth-server";
import { startPending, startSession } from "@/lib/session";
import { firstIssue, pickValues, type FormState } from "@/app/login/form-state";

const schema = z.object({
  token: z.string().min(1).max(200),
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

/** 招待を受けて、ユーザーを作る。作れたらログイン済みにする（2段階認証が必須なら、設定の画面へ）。 */
export async function acceptInviteAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = pickValues(formData, ["loginId", "displayName"]);
  const parsed = schema.safeParse({
    token: formData.get("token"),
    loginId: formData.get("loginId"),
    displayName: formData.get("displayName"),
    password: formData.get("password"),
    confirm: formData.get("confirm"),
  });
  if (!parsed.success) return { error: firstIssue(parsed.error), values };
  if (parsed.data.password !== parsed.data.confirm) {
    return { error: "確認用のパスワードが一致しません", values };
  }

  const result = await acceptInvite(
    parsed.data.token,
    {
      loginId: parsed.data.loginId,
      displayName: parsed.data.displayName,
      password: parsed.data.password,
    },
    await clientIp(),
  );
  if (!result.ok) return { error: result.error, values };

  // 2段階認証が必須なら、設定が終わるまでセッションは付けない
  if (await isTotpRequired()) {
    await startPending(result.value.userId, "enroll");
    redirect("/login/enroll");
  }
  await startSession(result.value.userId);
  redirect("/");
}
