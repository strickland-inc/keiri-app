import * as React from "react";
import { cn } from "@/lib/utils";

/** 入力欄の共通の見た目（Input / Select / Textarea で共有）。 */
export const controlClass =
  "w-full rounded-[var(--radius)] border border-line-strong bg-surface px-3.5 text-sm text-ink placeholder:text-ink-faint transition-colors focus:border-ink/50 focus:outline-none focus:ring-4 focus:ring-ink/5 disabled:cursor-not-allowed disabled:opacity-50";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(controlClass, "h-10", className)}
      {...props}
    />
  ),
);
Input.displayName = "Input";
