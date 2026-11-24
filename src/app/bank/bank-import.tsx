"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { decodeText, type ParsedBankRow } from "@/domain/bank";
import { Icon } from "@/components/ui/icon";
import { Alert } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

/**
 * 1 回の仕訳リクエストに載せる取引数。1 リクエストで外部へ通信できるのは 50 回まで
 * （Cloudflare Workers 無料枠）。1 件につき Jev を最大 2 回呼び、Sheets の読み書きも加わるため、
 * 余裕を持たせて 8 件にしている。
 */
const CHUNK_SIZE = 8;

type Phase =
  | { kind: "idle" }
  | { kind: "reading"; fileName: string }
  | { kind: "classifying"; fileName: string; done: number; total: number }
  | { kind: "done"; summary: Summary }
  | { kind: "error"; message: string };

interface Summary {
  fileName: string;
  created: number;
  matched: number;
  review: number;
  duplicates: number;
  skipped: number;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok)
    throw new Error(data?.error ?? `処理に失敗しました (${res.status})`);
  return data as T;
}

export function BankImport() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [dragging, setDragging] = useState(false);

  const busy = phase.kind === "reading" || phase.kind === "classifying";

  async function importFile(file: File) {
    setPhase({ kind: "reading", fileName: file.name });
    try {
      const text = decodeText(await file.arrayBuffer());
      const parsed = await postJson<{
        rows: ParsedBankRow[];
        duplicates: number;
        skipped: number;
      }>("/api/bank/parse", { text });

      const summary: Summary = {
        fileName: file.name,
        created: 0,
        matched: 0,
        review: 0,
        duplicates: parsed.duplicates,
        skipped: parsed.skipped,
      };
      // 順に処理する（請求書の照合で同じ請求書を二重に使わないため）
      for (let i = 0; i < parsed.rows.length; i += CHUNK_SIZE) {
        setPhase({
          kind: "classifying",
          fileName: file.name,
          done: i,
          total: parsed.rows.length,
        });
        const r = await postJson<{
          created: number;
          duplicates: number;
          matched: number;
          review: number;
        }>("/api/bank/classify", {
          rows: parsed.rows.slice(i, i + CHUNK_SIZE),
        });
        summary.created += r.created;
        summary.matched += r.matched;
        summary.review += r.review;
        summary.duplicates += r.duplicates;
      }
      setPhase({ kind: "done", summary });
    } catch (e: unknown) {
      setPhase({
        kind: "error",
        message: e instanceof Error ? e.message : "取り込みに失敗しました",
      });
    } finally {
      router.refresh();
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function pick(files: FileList | null) {
    const file = files?.[0];
    if (file && !busy) void importFile(file);
  }

  return (
    <div className="flex flex-col gap-4">
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          pick(e.dataTransfer.files);
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center gap-3 rounded-2xl border border-dashed px-6 py-12 text-center transition-colors",
          dragging
            ? "border-ink bg-canvas"
            : "border-line-strong hover:bg-canvas/70",
          busy && "pointer-events-none opacity-60",
        )}
      >
        <Icon name="upload_file" className="text-[32px] text-ink-faint" />
        <span className="text-sm font-medium text-ink">
          明細 CSV をドロップ、または選ぶ
        </span>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.txt,text/csv"
          className="sr-only"
          onChange={(e) => pick(e.target.files)}
          disabled={busy}
        />
      </label>

      <div aria-live="polite">
        {phase.kind === "reading" && (
          <Progress label={`${phase.fileName} を読み取っています…`} />
        )}
        {phase.kind === "classifying" && (
          <Progress
            label={`Jev が仕訳しています… ${Math.min(phase.done + CHUNK_SIZE, phase.total)} / ${phase.total} 件`}
            ratio={phase.done / phase.total}
          />
        )}
        {phase.kind === "error" && <Alert tone="danger">{phase.message}</Alert>}
        {phase.kind === "done" && <DoneSummary summary={phase.summary} />}
      </div>
    </div>
  );
}

function Progress({ label, ratio }: { label: string; ratio?: number }) {
  return (
    <div className="flex flex-col gap-2 text-sm">
      <p className="text-ink-muted">{label}</p>
      <div className="h-1.5 overflow-hidden rounded-full bg-canvas">
        <div
          className={cn(
            "h-full rounded-full bg-ink transition-all",
            ratio === undefined && "w-1/3 animate-pulse",
          )}
          style={
            ratio === undefined
              ? undefined
              : { width: `${Math.max(ratio, 0.05) * 100}%` }
          }
        />
      </div>
    </div>
  );
}

function DoneSummary({ summary }: { summary: Summary }) {
  const parts = [
    `${summary.created} 件を仕訳しました`,
    summary.matched > 0
      ? `請求書と照合 ${summary.matched} 件（入金済みに更新）`
      : null,
    summary.review > 0 ? `要確認 ${summary.review} 件` : null,
    summary.duplicates > 0
      ? `取り込み済みのためスキップ ${summary.duplicates} 件`
      : null,
    summary.skipped > 0 ? `読み取れない行 ${summary.skipped} 件` : null,
  ].filter(Boolean);
  return (
    <Alert tone="success">
      <span className="font-medium">{summary.fileName}</span>:{" "}
      {parts.join(" ／ ")}
    </Alert>
  );
}
