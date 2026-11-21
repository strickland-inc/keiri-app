"use client";

import { useActionState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { createApiToken, type CreateTokenState } from "./actions";

export function CreateTokenForm() {
  const [state, action, pending] = useActionState<CreateTokenState, FormData>(
    createApiToken,
    {},
  );

  return (
    <div className="flex flex-col gap-4">
      <form
        action={action}
        className="flex flex-col gap-3 sm:flex-row sm:items-end"
      >
        <Field
          label="名前"
          htmlFor="name"
          hint="何に使うトークンかが分かる名前"
          required
          className="flex-1"
        >
          <Input
            id="name"
            name="name"
            type="text"
            placeholder="例：請求書を作るエージェント"
            maxLength={64}
            required
          />
        </Field>
        <Button type="submit" disabled={pending}>
          {pending ? "発行中…" : "発行する"}
        </Button>
      </form>

      {state.error && <Alert tone="danger">{state.error}</Alert>}

      {state.token && (
        <Alert tone="warning">
          <p className="font-medium">
            「{state.name}
            」を発行しました。このトークンは再表示できません。今のうちに控えてください。
          </p>
          <p className="mt-3 select-all break-all rounded-lg bg-surface px-3 py-1.5 font-mono text-ink">
            {state.token}
          </p>
        </Alert>
      )}
    </div>
  );
}
