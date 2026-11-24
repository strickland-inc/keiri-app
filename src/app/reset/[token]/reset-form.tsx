"use client";

import { useActionState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { PasswordPair } from "@/components/ui/password-pair";
import type { FormState } from "@/app/login/form-state";
import { resetPasswordAction } from "./actions";

export function ResetForm({
  token,
  loginId,
}: {
  token: string;
  /** パスワードマネージャーが、どのアカウントの更新か分かるように入れておく。 */
  loginId: string;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(
    resetPasswordAction,
    {},
  );

  return (
    <form action={action} className="flex flex-col gap-4">
      {state.error && <Alert tone="danger">{state.error}</Alert>}
      <input type="hidden" name="token" value={token} />
      <input
        type="text"
        name="username"
        value={loginId}
        autoComplete="username"
        readOnly
        hidden
      />
      <PasswordPair
        passwordLabel="新しいパスワード"
        confirmLabel="新しいパスワードの確認"
        autoFocus
      />
      <Button type="submit" className="mt-2 w-full" disabled={pending}>
        パスワードを変える
      </Button>
    </form>
  );
}
