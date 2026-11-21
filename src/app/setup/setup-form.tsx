"use client";

import { useActionState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { createFirstAdmin, type SetupState } from "./actions";

export function SetupForm() {
  const [state, action, pending] = useActionState<SetupState, FormData>(
    createFirstAdmin,
    {},
  );

  return (
    <form action={action} className="flex flex-col gap-4">
      {state.error && <Alert tone="danger">{state.error}</Alert>}
      <Field
        label="接続コード"
        htmlFor="connectionCode"
        hint="スプレッドシートのメニュー「keiri-app」で発行したコード"
      >
        <Input
          id="connectionCode"
          name="connectionCode"
          type="password"
          autoComplete="off"
          required
          autoFocus
        />
      </Field>
      <Field label="ログイン ID" htmlFor="loginId">
        <Input
          id="loginId"
          name="loginId"
          type="text"
          autoComplete="username"
          defaultValue={state.loginId}
          required
        />
      </Field>
      <Field label="パスワード" htmlFor="password" hint="12 文字以上">
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={12}
          required
        />
      </Field>
      <Button type="submit" className="mt-2 w-full" disabled={pending}>
        管理者を作って始める
      </Button>
    </form>
  );
}
