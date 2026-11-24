"use client";

import { useActionState } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
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
        <Field label="名前" htmlFor="name" required className="flex-1">
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
        <div className="flex flex-col gap-3 rounded-[var(--radius)] border border-line bg-canvas px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="truncate text-sm font-semibold">{state.name}</h3>
            <Badge tone="warning">1 回だけ表示</Badge>
          </div>
          <p className="select-all break-all rounded-lg bg-surface px-3 py-1.5 font-mono text-[13px] text-ink">
            {state.token}
          </p>
          <div>
            <CopyButton value={state.token} />
          </div>
        </div>
      )}
    </div>
  );
}
