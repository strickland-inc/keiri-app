import type { ChangeEvent, RefObject } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { EXPENSE_CATEGORIES } from "@/domain/expense";

/** 確認シートで編集する読み取り結果。 */
export interface ConfirmData {
  date: string;
  merchant: string;
  amount: number;
  category: string;
}

/** ノッチ・ホームバーに被らないよう、画面端の余白に安全領域を足す。 */
const safeTop = (extra: string) => ({
  top: `calc(env(safe-area-inset-top) + ${extra})`,
});
const safeBottom = (extra: string) => ({
  bottom: `calc(env(safe-area-inset-bottom) + ${extra})`,
});

/** 領収書を収める枠。外側は box-shadow で暗くする。 */
export function GuideOverlay() {
  return (
    <div className="pointer-events-none absolute inset-0">
      <div className="absolute left-1/2 top-[40%] h-52 w-72 -translate-x-1/2 -translate-y-1/2 sm:h-60 sm:w-96">
        <div
          className="absolute inset-0"
          style={{ boxShadow: "0 0 0 9999px rgba(0,0,0,0.45)" }}
        />
        <div className="absolute left-0 top-0 size-7 border-l-2 border-t-2 border-white" />
        <div className="absolute right-0 top-0 size-7 border-r-2 border-t-2 border-white" />
        <div className="absolute bottom-0 left-0 size-7 border-b-2 border-l-2 border-white" />
        <div className="absolute bottom-0 right-0 size-7 border-b-2 border-r-2 border-white" />
      </div>
    </div>
  );
}

/** 画面下の状態表示（カメラ操作中のみ）。 */
export function StatusPill({
  message,
  busy,
}: {
  message: string;
  busy: boolean;
}) {
  return (
    <div
      className="absolute inset-x-0 flex justify-center"
      style={safeBottom("2.5rem")}
    >
      <div className="flex items-center gap-2 rounded-full bg-black/60 px-4 py-2 text-sm text-white backdrop-blur-sm">
        {busy && (
          <Icon name="progress_activity" className="animate-spin text-[16px]" />
        )}
        {message}
      </div>
    </div>
  );
}

/** 画像ファイルを読み取り中の全面表示。 */
export function FileAnalyzingOverlay() {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/80">
      <Icon
        name="progress_activity"
        className="animate-spin text-[40px] text-white"
      />
      <p className="text-sm text-white">読み取り中...</p>
    </div>
  );
}

interface ScanErrorProps {
  message: string;
  /** カメラが使えないとき、画像選択で代替できる。 */
  canPickFile: boolean;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onFileSelect: (e: ChangeEvent<HTMLInputElement>) => void;
  onBack: () => void;
}

export function ScanError({
  message,
  canPickFile,
  fileInputRef,
  onFileSelect,
  onBack,
}: ScanErrorProps) {
  return (
    <div
      className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/90 p-8 text-center"
      style={{
        paddingTop: "calc(env(safe-area-inset-top) + 2rem)",
        paddingBottom: "calc(env(safe-area-inset-bottom) + 2rem)",
      }}
    >
      <Icon
        name={canPickFile ? "photo_library" : "no_photography"}
        className="text-[48px] text-white/50"
      />
      <p className="text-sm text-white">{message}</p>
      {canPickFile && (
        <label
          className={`${buttonVariants({ variant: "secondary" })} cursor-pointer`}
        >
          <Icon name="upload_file" className="text-[18px]" />
          画像を選択して登録
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={onFileSelect}
          />
        </label>
      )}
      <Button
        variant="secondary"
        className="border-white/30 bg-transparent text-white hover:bg-white/10"
        onClick={onBack}
      >
        経費一覧に戻る
      </Button>
    </div>
  );
}

interface ConfirmSheetProps {
  values: ConfirmData;
  onChange: (next: ConfirmData) => void;
  onRegister: () => void;
  onDiscard: () => void;
  isRegistering: boolean;
}

/** 読み取り結果を確認・修正して登録するボトムシート。 */
export function ConfirmSheet({
  values,
  onChange,
  onRegister,
  onDiscard,
  isRegistering,
}: ConfirmSheetProps) {
  return (
    <div className="absolute inset-0 flex flex-col justify-end bg-black/50">
      <div
        className="rounded-t-2xl bg-surface p-5"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 1.25rem)" }}
      >
        <div className="mb-4 flex items-center gap-2">
          <Icon name="task_alt" className="text-[20px] text-brand-500" />
          <p className="font-semibold text-ink">領収書を読み取りました</p>
        </div>
        <div className="space-y-3">
          <Field label="日付" htmlFor="scan-date">
            <Input
              id="scan-date"
              type="date"
              value={values.date}
              onChange={(e) => onChange({ ...values, date: e.target.value })}
            />
          </Field>
          <Field label="店名" htmlFor="scan-merchant">
            <Input
              id="scan-merchant"
              type="text"
              value={values.merchant}
              onChange={(e) =>
                onChange({ ...values, merchant: e.target.value })
              }
            />
          </Field>
          <Field label="金額（円）" htmlFor="scan-amount">
            <Input
              id="scan-amount"
              type="number"
              className="tabular"
              value={values.amount}
              onChange={(e) =>
                onChange({ ...values, amount: Number(e.target.value) })
              }
            />
          </Field>
          <Field label="費目" htmlFor="scan-category">
            <Select
              id="scan-category"
              value={values.category}
              onChange={(e) =>
                onChange({ ...values, category: e.target.value })
              }
            >
              {EXPENSE_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="mt-5 flex gap-3">
          <Button
            variant="secondary"
            className="flex-1"
            onClick={onDiscard}
            disabled={isRegistering}
          >
            やり直す
          </Button>
          <Button
            className="flex-1"
            onClick={onRegister}
            disabled={isRegistering}
          >
            {isRegistering ? "登録中..." : "登録する"}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="absolute left-4 flex size-11 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-sm"
      style={safeTop("1rem")}
      aria-label="経費一覧に戻る"
    >
      <Icon name="arrow_back" className="text-[20px]" />
    </button>
  );
}

export function Toast({ message }: { message: string }) {
  return (
    <div
      className="absolute left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-ink/90 px-4 py-2 text-sm text-white"
      style={safeTop("1rem")}
    >
      {message}
    </div>
  );
}
