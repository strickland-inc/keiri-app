"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type MessageKind = "email" | "chat";
type CopyTarget = "subject" | "body";

interface MessageCopyPanelProps {
  emailSubject: string;
  emailBody: string;
  chatBody: string;
}

const KIND_TABS: ReadonlyArray<{ key: MessageKind; label: string }> = [
  { key: "email", label: "メール用" },
  { key: "chat", label: "チャット用" },
];

export function MessageCopyPanel({
  emailSubject,
  emailBody,
  chatBody,
}: MessageCopyPanelProps) {
  const [kind, setKind] = useState<MessageKind>("email");
  const [copied, setCopied] = useState<CopyTarget | null>(null);
  const isEmail = kind === "email";
  const body = isEmail ? emailBody : chatBody;

  async function copyText(target: CopyTarget, text: string) {
    await navigator.clipboard.writeText(text);
    setCopied(target);
    window.setTimeout(() => setCopied(null), 1400);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle
          title="送付文"
          action={<KindSwitch value={kind} onChange={setKind} />}
        />
      </CardHeader>

      <CardBody className="flex flex-col gap-5">
        {isEmail && (
          <Field label="件名" htmlFor="message-subject" className="gap-2">
            <div className="flex items-center gap-2">
              <Input
                id="message-subject"
                readOnly
                value={emailSubject}
                className="bg-canvas"
              />
              <CopyButton
                done={copied === "subject"}
                label="件名をコピー"
                onClick={() => copyText("subject", emailSubject)}
              />
            </div>
          </Field>
        )}

        <Field
          label={isEmail ? "メール本文" : "チャット本文"}
          htmlFor="message-body"
          className="gap-2"
        >
          <Textarea
            id="message-body"
            readOnly
            value={body}
            className="min-h-[220px] bg-canvas leading-6"
          />
          <div className="flex justify-end">
            <CopyButton
              done={copied === "body"}
              label="本文をコピー"
              onClick={() => copyText("body", body)}
            />
          </div>
        </Field>
      </CardBody>
    </Card>
  );
}

/** メール用 / チャット用の切り替え（LinkTabs と同じ見た目）。 */
function KindSwitch({
  value,
  onChange,
}: {
  value: MessageKind;
  onChange: (kind: MessageKind) => void;
}) {
  return (
    <div className="inline-flex gap-0.5 rounded-full bg-canvas p-1">
      {KIND_TABS.map((tab) => (
        <button
          key={tab.key}
          type="button"
          aria-pressed={value === tab.key}
          onClick={() => onChange(tab.key)}
          className={cn(
            "whitespace-nowrap rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors",
            value === tab.key
              ? "bg-surface text-ink shadow-[0_0_0_1px_var(--color-line)]"
              : "text-ink-muted hover:text-ink",
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

function CopyButton({
  done,
  label,
  onClick,
}: {
  done: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button type="button" variant="secondary" size="sm" onClick={onClick}>
      <Icon name={done ? "check" : "content_copy"} className="text-[16px]" />
      {done ? "コピー済み" : label}
    </Button>
  );
}
