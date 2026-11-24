"use client";

import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { Td, Tr } from "@/components/ui/table";
import { ROLE_LABELS, type UserRole, type UserStatus } from "@/domain/user";
import { ActionButton } from "./action-button";
import {
  createResetLinkAction,
  deleteUserAction,
  resetTotpAction,
  setRoleAction,
  setStatusAction,
  type ActionResult,
  type IssuedLink,
} from "./actions";
import { OneTimeLink } from "./one-time-link";

export interface UserRowData {
  id: string;
  loginId: string;
  displayName: string;
  role: UserRole;
  status: UserStatus;
  totpEnabled: boolean;
  /** サーバー側で整えた文字列。ログインの記録が無ければ空。 */
  lastLogin: string;
  isSelf: boolean;
  /** 有効な管理者のうち、最後の 1 人。降格・無効化・削除できない。 */
  isLastAdmin: boolean;
}

/** 無効化・削除の確認の中に置く、API トークンの一覧へのリンク。 */
const TOKEN_LINK = { href: "/settings", label: "API トークン" };

export function UserRow({ user }: { user: UserRowData }) {
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [link, setLink] = useState<IssuedLink | null>(null);
  const [rolePending, startRole] = useTransition();

  const name = `${user.displayName}（${user.loginId}）`;
  const disabled = user.status === "disabled";

  function handleResult(result: ActionResult, done = "") {
    setLink(null);
    if (result.ok) {
      setError("");
      setNotice(done);
      if (result.link) setLink(result.link);
    } else {
      setNotice("");
      setError(result.error);
    }
  }

  function changeRole(role: UserRole) {
    if (role === user.role) return;
    const label = ROLE_LABELS[role];
    if (!confirm(`${name} の役割を「${label}」に変えますか？`)) return;
    startRole(async () => {
      try {
        handleResult(await setRoleAction(user.id, role), "役割を変えました");
      } catch (e) {
        handleResult({
          ok: false,
          error: e instanceof Error ? e.message : "操作に失敗しました",
        });
      }
    });
  }

  return (
    <>
      <Tr className="border-b-0">
        <Td>
          <div className="w-44 sm:w-56">
            <p className="truncate font-medium" title={user.displayName}>
              {user.displayName}
            </p>
            <p
              className="truncate font-mono text-xs text-ink-muted"
              title={user.loginId}
            >
              {user.loginId}
            </p>
          </div>
        </Td>
        <Td>
          {user.isSelf || user.isLastAdmin ? (
            <Badge tone={user.role === "admin" ? "brand" : "neutral"}>
              {ROLE_LABELS[user.role]}
            </Badge>
          ) : (
            <div className="w-28">
              <Select
                aria-label={`${name} の役割`}
                value={user.role}
                disabled={rolePending}
                onChange={(e) => changeRole(e.target.value as UserRole)}
                className="h-8 text-[13px]"
              >
                <option value="user">メンバー</option>
                <option value="admin">管理者</option>
              </Select>
            </div>
          )}
        </Td>
        <Td>
          <Badge tone={disabled ? "danger" : "success"}>
            {disabled ? "無効" : "有効"}
          </Badge>
        </Td>
        <Td>
          <Badge tone={user.totpEnabled ? "success" : "neutral"}>
            {user.totpEnabled ? "設定済み" : "未設定"}
          </Badge>
        </Td>
        <Td muted nowrap>
          {user.lastLogin || "記録なし"}
        </Td>
      </Tr>
      <Tr className={error || notice || link ? "border-b-0" : ""}>
        <Td colSpan={5} className="pt-0">
          {/* 表が横にスクロールしても、ボタンが画面の外へ出ないよう、幅を画面に収める */}
          <div className="flex max-w-[calc(100vw-5rem)] flex-wrap items-center gap-1.5">
            {!user.isSelf && (
              <ActionButton
                label="再設定リンク"
                pendingLabel="作成中…"
                run={() => createResetLinkAction(user.id)}
                onResult={(r) => handleResult(r)}
              />
            )}
            {!user.isSelf && user.totpEnabled && (
              <ActionButton
                label="2段階認証をリセット"
                pendingLabel="処理中…"
                confirmMessage={`${name} の 2段階認証をリセットしますか？`}
                run={() => resetTotpAction(user.id)}
                onResult={(r) => handleResult(r, "2段階認証をリセットしました")}
              />
            )}
            {!user.isSelf && !user.isLastAdmin && !disabled && (
              <ActionButton
                label="無効にする"
                pendingLabel="処理中…"
                confirmMessage={`${name} を無効にしますか？`}
                confirmLink={TOKEN_LINK}
                run={() => setStatusAction(user.id, "disabled")}
                onResult={(r) => handleResult(r, "無効にしました")}
              />
            )}
            {!user.isSelf && disabled && (
              <ActionButton
                label="再開する"
                pendingLabel="処理中…"
                run={() => setStatusAction(user.id, "active")}
                onResult={(r) => handleResult(r, "再開しました")}
              />
            )}
            {!user.isSelf && !user.isLastAdmin && (
              <ActionButton
                label="削除"
                pendingLabel="削除中…"
                variant="danger"
                confirmMessage={`${name} を削除しますか？`}
                confirmLink={TOKEN_LINK}
                run={() => deleteUserAction(user.id)}
                onResult={(r) => handleResult(r)}
              />
            )}
            {user.isSelf && (
              <span className="self-center text-xs text-ink-faint">
                自分自身
              </span>
            )}
          </div>
        </Td>
      </Tr>
      {(error || notice || link) && (
        <tr>
          <td colSpan={5} className="bg-canvas/50 px-4 py-3">
            {error && (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            )}
            {notice && <p className="text-sm text-success">{notice}</p>}
            {link && (
              <OneTimeLink
                title={`${user.displayName} さんの再設定リンクを作りました`}
                link={link}
              />
            )}
          </td>
        </tr>
      )}
    </>
  );
}
