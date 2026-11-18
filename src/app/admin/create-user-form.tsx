"use client";

import { useActionState } from "react";
import { createUser, type CreateUserState } from "./actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

const initialState: CreateUserState = { ok: false };

export function CreateUserForm() {
  const [state, action, pending] = useActionState(createUser, initialState);

  return (
    <Card>
      <CardHeader>
        <CardTitle title="ユーザーを発行" />
      </CardHeader>
      <CardBody className="flex flex-col gap-4 p-6">
        <form
          action={action}
          className="flex flex-col gap-3 sm:flex-row sm:items-end"
        >
          <Field
            label="ログインID"
            htmlFor="loginId"
            required
            className="flex-1"
          >
            <Input
              id="loginId"
              name="loginId"
              type="text"
              placeholder="例：tanaka"
              required
            />
          </Field>
          <Button type="submit" disabled={pending}>
            {pending ? "発行中…" : "発行する"}
          </Button>
        </form>

        {state.error && <Alert tone="danger">{state.error}</Alert>}

        {state.ok && state.password && (
          <Alert tone="warning">
            <p className="font-medium">
              発行しました。このパスワードは再表示できません。今のうちに本人へ伝えてください。
            </p>
            <dl className="mt-3 grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2">
              <dt className="text-xs">ログインID</dt>
              <dd className="select-all break-all rounded-lg bg-surface px-3 py-1.5 font-mono text-ink">
                {state.loginId}
              </dd>
              <dt className="text-xs">パスワード</dt>
              <dd className="select-all break-all rounded-lg bg-surface px-3 py-1.5 font-mono font-semibold text-ink">
                {state.password}
              </dd>
            </dl>
          </Alert>
        )}
      </CardBody>
    </Card>
  );
}
