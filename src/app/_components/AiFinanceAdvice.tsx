"use client";

import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

interface AdviceResponse {
  suggestions: string[];
}

interface ErrorResponse {
  error?: string;
}

export function AiFinanceAdvice(): React.ReactElement {
  const [suggestions, setSuggestions] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFetch(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/finance-advice");
      if (!res.ok) {
        const data = (await res.json()) as ErrorResponse;
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as AdviceResponse;
      setSuggestions(data.suggestions);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "エラーが発生しました");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {!suggestions && !loading && (
        <Button
          variant="secondary"
          size="sm"
          onClick={handleFetch}
          className="self-start"
        >
          <Icon name="auto_awesome" className="text-[16px]" />
          提案を見る
        </Button>
      )}

      {loading && (
        <p className="flex items-center gap-2 text-sm text-ink-muted">
          <Icon name="progress_activity" className="animate-spin text-[16px]" />
          分析しています…
        </p>
      )}

      {error && <Alert tone="danger">{error}</Alert>}

      {suggestions && (
        <>
          <ul className="flex flex-col gap-3">
            {suggestions.map((suggestion) => (
              <li
                key={suggestion}
                className="flex gap-2.5 text-sm leading-relaxed"
              >
                <span
                  className="mt-2 size-1 shrink-0 rounded-full bg-ink-faint"
                  aria-hidden="true"
                />
                {suggestion}
              </li>
            ))}
          </ul>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleFetch}
            disabled={loading}
            className="self-start"
          >
            <Icon name="refresh" className="text-[16px]" />
            再取得
          </Button>
        </>
      )}
    </div>
  );
}
