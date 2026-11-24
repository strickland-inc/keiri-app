"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { clientIp, resetPasswordWithLink } from "@/lib/auth-server";
import { firstIssue, type FormState } from "@/app/login/form-state";

const schema = z.object({
  token: z.string().min(1).max(200),
  password: z
    .string()
    .min(1, "パスワードを入れてください")
    .max(200, "パスワードは 200 文字以内にしてください"),
  confirm: z.string(),
});

/** 再設定リンクで新しいパスワードを決める。終わったらログイン画面へ（全端末がログアウトになる）。 */
export async function resetPasswordAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = schema.safeParse({
    token: formData.get("token"),
    password: formData.get("password"),
    confirm: formData.get("confirm"),
  });
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  if (parsed.data.password !== parsed.data.confirm) {
    return { error: "確認用のパスワードが一致しません" };
  }

  const result = await resetPasswordWithLink(
    parsed.data.token,
    parsed.data.password,
    await clientIp(),
  );
  if (!result.ok) return { error: result.error };
  redirect("/login?reset=1");
}
