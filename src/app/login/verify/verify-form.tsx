"use client";

import { useActionState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { verifyCode } from "../actions";
import type { FormState } from "../form-state";

export function VerifyForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(
    verifyCode,
    {},
  );

  return (
    <form action={action} className="flex flex-col gap-4">
      {state.error && <Alert tone="danger">{state.error}</Alert>}
      <input type="hidden" name="next" value={next} />
      <Field label="確認コード" htmlFor="code">
        <Input
          id="code"
          name="code"
          type="text"
          inputMode="text"
          autoComplete="one-time-code"
          autoCapitalize="none"
          spellCheck={false}
          className="tabular tracking-widest"
          required
          autoFocus
        />
      </Field>
      <Button type="submit" className="mt-2 w-full" disabled={pending}>
        確認してログイン
      </Button>
    </form>
  );
}
