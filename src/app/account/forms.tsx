"use client";

import { useActionState, useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { SectionCard } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PasswordPair } from "@/components/ui/password-pair";
import {
  beginEnrollmentAction,
  changeDisplayNameAction,
  changePasswordAction,
  confirmEnrollmentAction,
  disableTotpAction,
  regenerateCodesAction,
  revokeAllSessionsAction,
  type AccountState,
  type EnrollmentState,
} from "./actions";

const initial: AccountState = {};

function Result({ state }: { state: AccountState }) {
  if (state.error) return <Alert tone="danger">{state.error}</Alert>;
  if (state.ok && state.message) {
    return <Alert tone="success">{state.message}</Alert>;
  }
  return null;
}

// ── 表示名 ────────────────────────────────────────────────────────────────────

export function DisplayNameForm({
  displayName,
  loginId,
}: {
  displayName: string;
  loginId: string;
}) {
  const [state, action, pending] = useActionState(
    changeDisplayNameAction,
    initial,
  );
  return (
    <SectionCard title="表示名">
      <form action={action} className="flex flex-col gap-4">
        <Field label="ログイン ID" htmlFor="loginId">
          <Input id="loginId" value={loginId} readOnly disabled />
        </Field>
        <Field label="表示名" htmlFor="displayName" required>
          <Input
            id="displayName"
            name="displayName"
            defaultValue={displayName}
            maxLength={50}
            required
          />
        </Field>
        <Result state={state} />
        <div>
          <Button type="submit" variant="secondary" disabled={pending}>
            {pending ? "保存中…" : "表示名を保存"}
          </Button>
        </div>
      </form>
    </SectionCard>
  );
}

// ── パスワード ────────────────────────────────────────────────────────────────

export function PasswordForm() {
  const [state, action, pending] = useActionState(
    changePasswordAction,
    initial,
  );
  return (
    <SectionCard title="パスワードの変更">
      <form
        // 成功したら入力を空にする（key で作り直す）
        key={state.ok ? "done" : "form"}
        action={action}
        className="flex flex-col gap-4"
      >
        <Field label="いまのパスワード" htmlFor="current" required>
          <Input
            id="current"
            name="current"
            type="password"
            autoComplete="current-password"
            required
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <PasswordPair
            passwordName="next"
            confirmName="confirm"
            passwordLabel="新しいパスワード"
            confirmLabel="新しいパスワードの確認"
          />
        </div>
        <Result state={state} />
        <div>
          <Button type="submit" variant="secondary" disabled={pending}>
            {pending ? "変更中…" : "パスワードを変更"}
          </Button>
        </div>
      </form>
    </SectionCard>
  );
}

// ── 回復コード ────────────────────────────────────────────────────────────────

function RecoveryCodes({
  codes,
  onClose,
}: {
  codes: string[];
  onClose: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-[var(--radius)] border border-line bg-canvas px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">回復コード {codes.length} 個</h3>
        <Badge tone="warning">1 回だけ表示</Badge>
      </div>
      <ul className="grid grid-cols-2 gap-x-6 gap-y-1 rounded-lg bg-surface px-4 py-3 font-mono text-[13px] sm:grid-cols-5">
        {codes.map((c) => (
          <li key={c} className="select-all">
            {c}
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <CopyButton value={codes.join("\n")} label="すべてコピー" />
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          閉じる
        </Button>
      </div>
    </div>
  );
}

// ── 2段階認証 ─────────────────────────────────────────────────────────────────

/** 番号つきの段の見出し。 */
function Step({ n, title }: { n: number; title: string }) {
  return (
    <h3 className="flex items-center gap-2.5 text-sm font-semibold">
      <span className="tabular flex size-6 items-center justify-center rounded-full bg-ink text-xs text-white">
        {n}
      </span>
      {title}
    </h3>
  );
}

/** 手入力用の秘密を 4 文字ずつに区切る。 */
function groupSecret(secret: string): string {
  return secret
    .replace(/\s/g, "")
    .replace(/(.{4})/g, "$1 ")
    .trim();
}

function PasswordConfirmForm({
  id,
  label,
  buttonLabel,
  variant,
  confirmMessage,
  actionFn,
  onState,
  disabled,
}: {
  id: string;
  label: string;
  buttonLabel: string;
  variant: "secondary" | "danger";
  confirmMessage?: string;
  actionFn: (prev: AccountState, formData: FormData) => Promise<AccountState>;
  onState?: (state: AccountState) => void;
  disabled?: boolean;
}) {
  const [state, action, pending] = useActionState(
    async (prev: AccountState, formData: FormData) => {
      const next = await actionFn(prev, formData);
      onState?.(next);
      return next;
    },
    initial,
  );
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (confirmMessage && !confirm(confirmMessage)) e.preventDefault();
      }}
      className="flex flex-col gap-3"
    >
      <Field label={label} htmlFor={id}>
        <Input
          id={id}
          name="password"
          type="password"
          autoComplete="current-password"
          required
          disabled={disabled}
        />
      </Field>
      {state.error && <Alert tone="danger">{state.error}</Alert>}
      {state.ok && state.message && !state.recoveryCodes && (
        <Alert tone="success">{state.message}</Alert>
      )}
      <div>
        <Button
          type="submit"
          variant={variant}
          size="sm"
          disabled={pending || disabled}
        >
          {pending ? "処理中…" : buttonLabel}
        </Button>
      </div>
    </form>
  );
}

export function TotpSection({
  enabled,
  required,
}: {
  enabled: boolean;
  /** 管理者が 2段階認証を必須にしているか。 */
  required: boolean;
}) {
  const [enroll, setEnroll] = useState<EnrollmentState | null>(null);
  const [startError, setStartError] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [starting, startTransition] = useTransition();
  const [confirmState, confirmAction, confirming] = useActionState(
    async (prev: AccountState, formData: FormData) => {
      const next = await confirmEnrollmentAction(prev, formData);
      if (next.ok && next.recoveryCodes) {
        setCodes(next.recoveryCodes);
        setEnroll(null);
      }
      return next;
    },
    initial,
  );

  function begin(formData: FormData) {
    const password = String(formData.get("password") ?? "");
    startTransition(async () => {
      const result = await beginEnrollmentAction(password);
      if (result.error) {
        setStartError(result.error);
        setEnroll(null);
      } else {
        setStartError("");
        setEnroll(result);
      }
    });
  }

  return (
    <SectionCard
      title="2段階認証"
      action={
        <div className="flex items-center gap-2">
          {required && <Badge tone="warning">必須</Badge>}
          <Badge tone={enabled ? "success" : "neutral"}>
            {enabled ? "設定済み" : "未設定"}
          </Badge>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        {codes && (
          <RecoveryCodes codes={codes} onClose={() => setCodes(null)} />
        )}

        {!enabled && !enroll && (
          <form action={begin} className="flex flex-col gap-3">
            <Field label="パスワード" htmlFor="enroll-password">
              <Input
                id="enroll-password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
            </Field>
            {startError && <Alert tone="danger">{startError}</Alert>}
            <div>
              <Button type="submit" disabled={starting}>
                {starting ? "準備中…" : "設定を始める"}
              </Button>
            </div>
          </form>
        )}

        {!enabled && enroll?.secret && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Step n={1} title="QR コード" />
              {enroll.qrSvg && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`data:image/svg+xml;utf8,${encodeURIComponent(enroll.qrSvg)}`}
                  alt="2段階認証の設定用 QR コード"
                  width={176}
                  height={176}
                  className="size-44 shrink-0 rounded-[var(--radius)] border border-line bg-surface p-2"
                />
              )}
            </div>
            <div className="flex flex-col gap-2">
              <Step n={2} title="秘密" />
              <p className="select-all break-all font-mono text-base tracking-wider text-ink">
                {groupSecret(enroll.secret)}
              </p>
              <div>
                <CopyButton value={enroll.secret.replace(/\s/g, "")} />
              </div>
            </div>
            <form action={confirmAction} className="flex flex-col gap-3">
              <Step n={3} title="確認コード" />
              <Field label="6 桁のコード" htmlFor="code" required>
                <div className="w-40">
                  <Input
                    id="code"
                    name="code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9 ]{6,7}"
                    maxLength={7}
                    placeholder="123456"
                    required
                  />
                </div>
              </Field>
              {confirmState.error && (
                <Alert tone="danger">{confirmState.error}</Alert>
              )}
              <div className="flex gap-2">
                <Button type="submit" disabled={confirming}>
                  {confirming ? "確認中…" : "有効にする"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setEnroll(null)}
                >
                  やめる
                </Button>
              </div>
            </form>
          </div>
        )}

        {enabled && (
          <div className="grid gap-6 border-t border-line pt-5 md:grid-cols-2">
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold">回復コードの再発行</h3>
              <PasswordConfirmForm
                id="regen-password"
                label="パスワード"
                buttonLabel="再発行する"
                variant="secondary"
                actionFn={regenerateCodesAction}
                onState={(s) => s.recoveryCodes && setCodes(s.recoveryCodes)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold">2段階認証の解除</h3>
              <PasswordConfirmForm
                id="disable-password"
                label="パスワード"
                buttonLabel="解除する"
                variant="danger"
                confirmMessage="2段階認証を解除し、ほかの端末をログアウトしますか？"
                actionFn={disableTotpAction}
                disabled={required}
              />
            </div>
          </div>
        )}
      </div>
    </SectionCard>
  );
}

// ── すべての端末からログアウト ────────────────────────────────────────────────

export function RevokeSessionsCard() {
  const [state, setState] = useState<AccountState>({});
  const [pending, startTransition] = useTransition();

  function run() {
    if (!confirm("ほかのすべての端末をログアウトしますか？")) return;
    startTransition(async () => {
      setState(await revokeAllSessionsAction());
    });
  }

  return (
    <SectionCard title="ログイン中の端末">
      <div className="flex flex-col gap-4">
        <Result state={state} />
        <div>
          <Button
            type="button"
            variant="secondary"
            onClick={run}
            disabled={pending}
          >
            {pending ? "処理中…" : "ほかのすべての端末をログアウト"}
          </Button>
        </div>
      </div>
    </SectionCard>
  );
}
