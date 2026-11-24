"use client";

import { useActionState } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { confirmEnroll, finishEnroll, type EnrollState } from "../actions";

/** 手入力しやすいように、4 文字ずつ区切る。 */
function groupSecret(secret: string): string {
  return secret.replace(/(.{4})/g, "$1 ").trim();
}

function Step({ n, title }: { n: number; title: string }) {
  return (
    <h2 className="flex items-center gap-2.5 text-sm font-semibold">
      <span className="tabular flex size-6 items-center justify-center rounded-full bg-ink text-xs text-white">
        {n}
      </span>
      {title}
    </h2>
  );
}

export function EnrollForm({
  secret,
  uri,
  qrSvg,
  next,
}: {
  secret: string;
  uri: string;
  qrSvg?: string;
  next: string;
}) {
  const [state, action, pending] = useActionState<EnrollState, FormData>(
    confirmEnroll,
    {},
  );

  // 設定が通ったら、回復コードを 1 度だけ見せる。控えたと押すまでセッションは付かない
  if (state.recoveryCodes) {
    const text = state.recoveryCodes.join("\n");
    return (
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">回復コード</h2>
          <Badge tone="warning">1 回だけ表示</Badge>
        </div>
        <ul className="grid grid-cols-2 gap-2 rounded-2xl border border-line bg-canvas p-4">
          {state.recoveryCodes.map((code) => (
            <li key={code} className="tabular text-center text-sm font-medium">
              {code}
            </li>
          ))}
        </ul>
        <CopyButton value={text} label="10 個をコピー" size="md" />
        <form action={finishEnroll}>
          <input type="hidden" name="next" value={next} />
          <Button type="submit" className="w-full">
            控えました。ログインを続ける
          </Button>
        </form>
      </div>
    );
  }

  const qrSrc = qrSvg
    ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(qrSvg)}`
    : null;

  return (
    <form action={action} className="flex flex-col gap-6">
      {state.error && <Alert tone="danger">{state.error}</Alert>}

      <ol className="flex flex-col gap-6">
        {qrSrc && (
          <li className="flex flex-col gap-3">
            <Step n={1} title="QR コード" />
            {/* eslint-disable-next-line @next/next/no-img-element -- data URL の SVG なので next/image は使わない */}
            <img
              src={qrSrc}
              alt="2段階認証の設定用 QR コード"
              width={192}
              height={192}
              className="mx-auto size-48 rounded-[var(--radius)] border border-line bg-surface p-2"
            />
            <a
              href={uri}
              className="text-center text-xs text-ink-muted underline underline-offset-2 hover:text-ink"
            >
              認証アプリで開く
            </a>
          </li>
        )}
        <li className="flex flex-col gap-3">
          <Step n={2} title="秘密" />
          <p className="tabular break-all rounded-[var(--radius)] bg-canvas px-3.5 py-2.5 text-center text-sm font-medium tracking-wider">
            {groupSecret(secret)}
          </p>
          <div className="flex justify-center">
            <CopyButton value={secret} />
          </div>
        </li>
        <li className="flex flex-col gap-3">
          <Step n={3} title="確認コード" />
          <Field label="6 桁のコード" htmlFor="code">
            <Input
              id="code"
              name="code"
              type="text"
              inputMode="numeric"
              pattern="[0-9 ]*"
              autoComplete="one-time-code"
              className="tabular tracking-widest"
              placeholder="123456"
              required
            />
          </Field>
        </li>
      </ol>

      <Button type="submit" className="w-full" disabled={pending}>
        設定を完了する
      </Button>
    </form>
  );
}
