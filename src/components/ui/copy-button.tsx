"use client";

import { useState } from "react";
import { Button } from "./button";
import { Icon } from "./icon";

/** 値をクリップボードへ写すボタン。押すと「コピー済み」に変わる。 */
export function CopyButton({
  value,
  label = "コピー",
  variant = "secondary",
  size = "sm",
}: {
  value: string;
  label?: string;
  variant?: "secondary" | "ghost";
  size?: "sm" | "md";
}) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
        } catch {
          setCopied(false);
        }
      }}
    >
      <Icon name={copied ? "check" : "content_copy"} className="text-[16px]" />
      {copied ? "コピー済み" : label}
    </Button>
  );
}
