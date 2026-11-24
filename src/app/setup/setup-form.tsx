"use client";

import { useActionState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PasswordPair } from "@/components/ui/password-pair";
import type { FormState } from "@/app/login/form-state";
import { createFirstAdmin } from "./actions";

export function SetupForm({ demo }: { demo: boolean }) {
  const [state, action, pending] = useActionState<FormState, FormData>(
    createFirstAdmin,
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
      <Field label="ログイン ID" htmlFor="loginId">
        <Input
          id="loginId"
          name="loginId"
          type="text"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          pattern="[A-Za-z0-9._@\-]{3,64}"
          minLength={3}
          maxLength={64}
          defaultValue={state.values?.loginId}
          required
        />
      </Field>
      <Field label="表示名" htmlFor="displayName">
        <Input
          id="displayName"
          name="displayName"
          type="text"
          autoComplete="name"
          defaultValue={state.values?.displayName}
          maxLength={50}
          required
        />
      </Field>
      <PasswordPair />
      <Button type="submit" className="mt-2 w-full" disabled={pending}>
        管理者を作って始める
      </Button>
    </form>
  );
}
