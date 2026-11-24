"use client";

import { useTransition } from "react";
import {
  changeBankAccount,
  confirmBankTransaction,
  removeBankTransaction,
} from "./actions";
import { Icon } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";

export function AccountSelect({
  id,
  account,
  options,
}: {
  id: string;
  account: string;
  options: readonly string[];
}) {
  const [pending, startTransition] = useTransition();
  // 現在の科目が選択肢に無い（照合済みの売掛金など）場合も表示できるようにする
  const list = options.includes(account) ? options : [account, ...options];
  return (
    <Select
      value={account}
      disabled={pending}
      aria-label="勘定科目"
      onChange={(e) =>
        startTransition(() => changeBankAccount(id, e.target.value))
      }
      className="h-8 min-w-36 text-[13px]"
    >
      {list.map((name) => (
        <option key={name} value={name}>
          {name}
        </option>
      ))}
    </Select>
  );
}

export function RowButtons({
  id,
  needsReview,
}: {
  id: string;
  needsReview: boolean;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex items-center justify-end gap-1">
      {needsReview && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={pending}
          title="この科目で問題ない"
          aria-label="この科目で確認済みにする"
          onClick={() => startTransition(() => confirmBankTransaction(id))}
          className="size-8 text-brand-600 hover:bg-brand-50 hover:text-brand-700"
        >
          <Icon name="check" className="text-[18px]" />
        </Button>
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        disabled={pending}
        title="この明細を削除"
        aria-label="この明細を削除"
        onClick={() => {
          if (confirm("この明細を削除しますか？")) {
            startTransition(() => removeBankTransaction(id));
          }
        }}
        className="size-8 hover:text-danger"
      >
        <Icon name="delete" className="text-[18px]" />
      </Button>
    </div>
  );
}
