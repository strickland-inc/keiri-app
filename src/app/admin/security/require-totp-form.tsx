"use client";

import { useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { setRequireTotpAction } from "../actions";

export function RequireTotpForm({
  required,
  canEnable,
}: {
  required: boolean;
  /** 操作している管理者自身が 2段階認証を設定済みか。 */
  canEnable: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  function toggle() {
    const next = !required;
    const message = next
      ? "2段階認証を必須にしますか？"
      : "2段階認証の必須をやめますか？";
    if (!confirm(message)) return;
    startTransition(async () => {
      try {
        const result = await setRequireTotpAction(next);
        setError(result.ok ? "" : result.error);
      } catch (e) {
        setError(e instanceof Error ? e.message : "操作に失敗しました");
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <p className="text-sm font-medium">いまの設定</p>
          <Badge tone={required ? "success" : "neutral"}>
            {required ? "必須" : "任意"}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          {!required && !canEnable && (
            <a
              href="/account"
              className={buttonVariants({ variant: "ghost", size: "sm" })}
            >
              自分の設定へ
            </a>
          )}
          <Button
            type="button"
            variant={required ? "secondary" : "primary"}
            onClick={toggle}
            disabled={pending || (!required && !canEnable)}
          >
            {pending ? "切り替え中…" : required ? "必須をやめる" : "必須にする"}
          </Button>
        </div>
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
    </div>
  );
}
