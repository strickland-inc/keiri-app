"use client";

import { useActionState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PasswordPair } from "@/components/ui/password-pair";
import type { FormState } from "@/app/login/form-state";
import { recoverAction } from "./actions";

export function RecoverForm({ demo }: { demo: boolean }) {
  const [state, action, pending] = useActionState<FormState, FormData>(
    recoverAction,
    {},
  );

  return (
    <form action={action} className="flex flex-col gap-4">
      {state.error && <Alert tone="danger">{state.error}</Alert>}
      <Field label="接続コード" htmlFor="connectionCode">
        <Input
          id="connectionCode"
          name="connectionCode"
          type="password"
          autoComplete="off"
          placeholder={demo ? "demo" : undefined}
          required
          autoFocus
        />
      </Field>
      <Field label="管理者のログイン ID" htmlFor="loginId">
        <Input
          id="loginId"
          name="loginId"
          type="text"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          defaultValue={state.values?.loginId}
          required
        />
      </Field>
      <PasswordPair
        passwordLabel="新しいパスワード"
        confirmLabel="新しいパスワードの確認"
      />
      <Button type="submit" className="mt-2 w-full" disabled={pending}>
        管理者のパスワードを入れ替える
      </Button>
    </form>
  );
}
