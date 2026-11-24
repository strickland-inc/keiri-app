"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { PASSWORD_MIN_LENGTH } from "@/lib/password-policy";
import { Field } from "./field";
import { Icon } from "./icon";
import { Input } from "./input";

/** 満たしたら色と印が変わる、小さな状態表示。 */
function Meter({ ok, children }: { ok: boolean; children: string }) {
  return (
    <span
      className={cn(
        "tabular inline-flex items-center gap-1 text-xs",
        ok ? "text-success" : "text-ink-faint",
      )}
    >
      <Icon name="check_circle" filled={ok} className="text-[14px]" />
      {children}
    </span>
  );
}

/** 新しいパスワードと確認の入力欄。文字数のカウンターと、一致の印を付ける。 */
export function PasswordPair({
  passwordName = "password",
  confirmName = "confirm",
  passwordLabel = "パスワード",
  confirmLabel = "パスワードの確認",
  autoFocus,
  className,
}: {
  passwordName?: string;
  confirmName?: string;
  passwordLabel?: string;
  confirmLabel?: string;
  autoFocus?: boolean;
  className?: string;
}) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const length = [...password].length;
  const lengthOk = length >= PASSWORD_MIN_LENGTH;
  const matched = confirm.length > 0 && confirm === password;

  return (
    <>
      <Field label={passwordLabel} htmlFor={passwordName} className={className}>
        <Input
          id={passwordName}
          name={passwordName}
          type="password"
          autoComplete="new-password"
          minLength={PASSWORD_MIN_LENGTH}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus={autoFocus}
          required
        />
        <Meter
          ok={lengthOk}
        >{`${Math.min(length, PASSWORD_MIN_LENGTH)} / ${PASSWORD_MIN_LENGTH}`}</Meter>
      </Field>
      <Field label={confirmLabel} htmlFor={confirmName} className={className}>
        <Input
          id={confirmName}
          name={confirmName}
          type="password"
          autoComplete="new-password"
          minLength={PASSWORD_MIN_LENGTH}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
        />
        <Meter ok={matched}>{matched ? "一致" : "未入力"}</Meter>
      </Field>
    </>
  );
}
