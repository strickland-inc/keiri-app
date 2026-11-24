"use client";

import { useActionState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { createInviteAction, type InviteFormState } from "./actions";
import { OneTimeLink } from "./one-time-link";

export function InviteForm() {
  const [state, action, pending] = useActionState<InviteFormState, FormData>(
    createInviteAction,
    {},
  );

  return (
    <SectionCard title="招待リンクを作る">
      <div className="flex flex-col gap-4">
        <form
          action={action}
          className="grid gap-3 sm:grid-cols-[10rem_1fr_auto] sm:items-end"
        >
          <Field label="役割" htmlFor="invite-role">
            <Select id="invite-role" name="role" defaultValue="user">
              <option value="user">メンバー</option>
              <option value="admin">管理者</option>
            </Select>
          </Field>
          <Field label="メモ" htmlFor="invite-note">
            <Input
              id="invite-note"
              name="note"
              maxLength={200}
              placeholder="例：経理の山田さん"
            />
          </Field>
          <Button type="submit" disabled={pending}>
            {pending ? "作成中…" : "リンクを作る"}
          </Button>
        </form>
        {state.error && <Alert tone="danger">{state.error}</Alert>}
        {state.link && (
          <OneTimeLink title="招待リンクを作りました" link={state.link} />
        )}
      </div>
    </SectionCard>
  );
}
