import * as React from "react";
import { cn } from "@/lib/utils";
import { controlClass } from "./input";

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(controlClass, "min-h-24 resize-y py-2.5", className)}
      {...props}
    />
  ),
);
Textarea.displayName = "Textarea";
