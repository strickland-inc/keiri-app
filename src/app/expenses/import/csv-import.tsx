"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Stat } from "@/components/ui/stat";
import {
  Table,
  TableCard,
  TBody,
  Td,
  Th,
  THead,
  Tr,
} from "@/components/ui/table";
import type { ClassifyMethod } from "@/domain/expense-rules";
import type { ExpenseCsvFormat } from "@/domain/expense-csv";
import { cn, formatJpDate } from "@/lib/utils";
import { MAX_FILE_BYTES, MAX_IMPORT_ROWS } from "./limits";
import {
  previewExpenseCsv,
  saveExpenseCsv,
  type ImportPreview,
} from "./actions";

type Phase =
  | { kind: "idle" }
  | { kind: "reading"; fileName: string }
  | { kind: "preview"; fileName: string; preview: ImportPreview }
  | { kind: "saving"; fileName: string; preview: ImportPreview }
  | { kind: "done"; fileName: string; created: number; remaining: number }
  | { kind: "error"; message: string };

const FORMAT_LABELS: Record<ExpenseCsvFormat, string> = {
  rakuten: "楽天カード",
  paypay: "PayPay",
  generic: "見出しから判定",
};

const METHOD_LABELS: Record<ClassifyMethod, string> = {
  learned: "過去の判断",
  rule: "ルール辞書",
  amount: "高額のため要確認",
  unknown: "判断できず",
};

function yen(n: number): string {
  return n.toLocaleString("ja-JP");
}

export function CsvImport() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [dragging, setDragging] = useState(false);

  const busy = phase.kind === "reading" || phase.kind === "saving";

  function reset() {
    setPhase({ kind: "idle" });
    if (inputRef.current) inputRef.current.value = "";
  }

  async function readFile(file: File) {
    if (file.size > MAX_FILE_BYTES) {
      setPhase({
        kind: "error",
        message: "ファイルが大きすぎます。月ごとなどに分けて取り込んでください",
      });
      return;
    }
    setPhase({ kind: "reading", fileName: file.name });
    try {
      const formData = new FormData();
      formData.set("file", file);
      const result = await previewExpenseCsv(formData);
      setPhase(
        result.ok
          ? { kind: "preview", fileName: file.name, preview: result.preview }
          : { kind: "error", message: result.error },
      );
    } catch {
      setPhase({ kind: "error", message: "CSV を読み取れませんでした" });
    }
  }

  async function save(fileName: string, preview: ImportPreview) {
    setPhase({ kind: "saving", fileName, preview });
    try {
      const result = await saveExpenseCsv(
        preview.rows.map(({ date, merchant, amount, category }) => ({
          date,
          merchant,
          amount,
          category,
        })),
      );
      setPhase(
        result.ok
          ? {
              kind: "done",
              fileName,
              created: result.created,
              remaining: preview.newTotal - preview.rows.length,
            }
          : { kind: "error", message: result.error },
      );
    } catch {
      setPhase({ kind: "error", message: "取り込みに失敗しました" });
    }
  }

  function pick(files: FileList | null) {
    const file = files?.[0];
    if (file && !busy) void readFile(file);
  }

  const showPicker =
    phase.kind === "idle" || phase.kind === "reading" || phase.kind === "error";

  return (
    <div className="flex flex-col gap-6">
      {showPicker && (
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
            カード明細の CSV をここにドロップ、またはクリックして選ぶ
          </span>
          <span className="max-w-md text-xs leading-relaxed text-ink-muted">
            文字コードと列の並びは自動で判定します。取り込むのは利用額が 0
            円より大きい行だけです。
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
      )}

      <div aria-live="polite" className="flex flex-col gap-6">
        {phase.kind === "reading" && (
          <p className="text-sm text-ink-muted">
            {phase.fileName} を読み取っています…
          </p>
        )}
        {phase.kind === "error" && <Alert tone="danger">{phase.message}</Alert>}
        {phase.kind === "done" && (
          <>
            <Alert tone="success">
              <span className="font-medium">{phase.fileName}</span>:{" "}
              {phase.created} 件を経費に取り込みました
              {phase.remaining > 0 &&
                `。残り ${phase.remaining} 件は、もう一度同じ CSV を選ぶと続きを取り込めます（取込済みは自動で飛ばします）`}
            </Alert>
            <div className="flex gap-2">
              <Link
                href="/expenses"
                className={buttonVariants({ variant: "secondary" })}
              >
                経費を見る
              </Link>
              <Button variant="ghost" onClick={reset}>
                別の CSV を取り込む
              </Button>
            </div>
          </>
        )}
        {(phase.kind === "preview" || phase.kind === "saving") && (
          <Preview
            fileName={phase.fileName}
            preview={phase.preview}
            saving={phase.kind === "saving"}
            onSave={() => void save(phase.fileName, phase.preview)}
            onCancel={reset}
          />
        )}
      </div>
    </div>
  );
}

function Preview({
  fileName,
  preview,
  saving,
  onSave,
  onCancel,
}: {
  fileName: string;
  preview: ImportPreview;
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  const reviewCount = preview.rows.filter(
    (r) => r.category === "要確認",
  ).length;
  const remaining = preview.newTotal - preview.rows.length;

  return (
    <>
      <p className="text-sm text-ink-muted">
        <span className="font-medium text-ink">{fileName}</span>（
        {FORMAT_LABELS[preview.format]}）
      </p>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="新規" value={preview.newTotal} unit="件" />
        <Stat
          label="取込済みで飛ばす"
          value={preview.duplicates}
          unit="件"
          hint="日付・利用先・金額が同じ経費"
        />
        <Stat
          label="読めなかった"
          value={preview.skipped}
          unit="件"
          hint="返金・支払い、日付や金額を読めない行"
        />
      </div>

      {remaining > 0 && (
        <Alert tone="warning">
          1 回に取り込めるのは {MAX_IMPORT_ROWS} 件までです。先頭の{" "}
          {preview.rows.length} 件を取り込み、残り {remaining}{" "}
          件は、取り込み後にもう一度同じ CSV を選んでください。
        </Alert>
      )}

      {preview.rows.length === 0 ? (
        <Alert tone="info">取り込む新しい明細はありません。</Alert>
      ) : (
        <>
          {reviewCount > 0 && (
            <p className="text-xs text-ink-muted">
              要確認 {reviewCount}{" "}
              件は、取り込み後に経費の一覧で費目を選び直せます。
            </p>
          )}
          <TableCard>
            <Table>
              <THead>
                <Th>日付</Th>
                <Th>利用先</Th>
                <Th align="right">金額</Th>
                <Th>費目</Th>
                <Th>決め方</Th>
              </THead>
              <TBody>
                {preview.rows.map((row, i) => (
                  <Tr
                    key={i}
                    className={cn(row.category === "要確認" && "bg-warning/5")}
                  >
                    <Td nowrap numeric muted>
                      {formatJpDate(row.date)}
                    </Td>
                    <Td className="max-w-xs">
                      <span className="line-clamp-2">{row.merchant}</span>
                    </Td>
                    <Td align="right" nowrap numeric>
                      {yen(row.amount)}
                    </Td>
                    <Td nowrap>{row.category}</Td>
                    <Td nowrap muted className="text-xs">
                      {METHOD_LABELS[row.method]}
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </TableCard>
        </>
      )}

      <div className="flex gap-2">
        {preview.rows.length > 0 && (
          <Button onClick={onSave} disabled={saving}>
            {saving
              ? "取り込んでいます…"
              : `${preview.rows.length} 件を取り込む`}
          </Button>
        )}
        <Button variant="secondary" onClick={onCancel} disabled={saving}>
          {preview.rows.length > 0 ? "やめる" : "別の CSV を選ぶ"}
        </Button>
      </div>
    </>
  );
}
