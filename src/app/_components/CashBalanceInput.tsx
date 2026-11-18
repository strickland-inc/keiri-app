"use client";

import { useState } from "react";
import { updateCashBalance } from "@/app/_actions/finance";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { controlClass } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface CashBalanceInputProps {
  currentBalance: number | null;
}

export function CashBalanceInput({
  currentBalance,
}: CashBalanceInputProps): React.ReactElement {
  const [value, setValue] = useState(
    currentBalance != null ? String(currentBalance) : "",
  );
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);

  async function handleSave(): Promise<void> {
    const num = Number(value.replace(/,/g, ""));
    if (isNaN(num)) return;
    setPending(true);
    await updateCashBalance(num);
    setPending(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label htmlFor="cash-balance" className="text-sm text-ink-muted">
        現金残高
      </label>
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ink-faint">
          ¥
        </span>
        <input
          id="cash-balance"
          type="text"
          inputMode="numeric"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="0"
          className={cn(controlClass, "h-8 w-40 pl-7 pr-3 tabular")}
        />
      </div>
      <Button
        size="sm"
        variant="secondary"
        onClick={handleSave}
        disabled={pending}
      >
        {saved ? (
          <>
            <Icon name="check" className="text-[16px] text-success" />
            保存しました
          </>
        ) : (
          "保存"
        )}
      </Button>
    </div>
  );
}
