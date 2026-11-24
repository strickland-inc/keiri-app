"use client";

import { useState } from "react";
import { ActionButton } from "./action-button";
import { revokeInviteAction } from "./actions";

export function RevokeInviteButton({ id }: { id: string }) {
  const [error, setError] = useState("");
  return (
    <div className="flex flex-col items-end gap-1">
      <ActionButton
        label="取り消す"
        pendingLabel="取り消し中…"
        variant="secondary"
        confirmMessage="このリンクを取り消しますか？"
        run={() => revokeInviteAction(id)}
        onResult={(r) => setError(r.ok ? "" : r.error)}
      />
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
