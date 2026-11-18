/// <reference types="styled-jsx/global" />
"use client";

import React, { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Button } from "@/components/ui/button";
import { controlClass } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// ── 定数 ──────────────────────────────────────────────────────────────

const PANEL_HEIGHT = 264;
const DOCK_HEIGHT = 48;
const DOCK_RADIUS = 24; // 閉じているときは完全な丸みのピル形
const PANEL_RADIUS = 16; // 開いたときは Card（rounded-2xl）と同じ

// ブランドの緑（brand-500 = #00ac3a ≈ oklch(55% 0.22 145)）の濃淡
const TONES = {
  base: "oklch(98% 0.01 145)",
  accent1: "oklch(55% 0.22 145)",
  accent2: "oklch(72% 0.16 148)",
  accent3: "oklch(38% 0.18 150)",
} as const;

// ── 型 ──────────────────────────────────────────────────────────────────

export interface AiOrbPanelProps {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void | Promise<void>;
  pending: boolean;
  error?: string | null;
}

// ── ColorOrb ───────────────────────────────────────────────────────────────
// conic-gradient を 6 枚重ね、@property で登録した --co-angle を回して動かす。
// .co-orb は styled-jsx でこのコンポーネントに閉じ、@property と @keyframes は全体に出す。

function ColorOrb({ dimension = 24 }: { dimension?: number }) {
  return (
    <>
      <div
        className="co-orb"
        style={
          {
            "--co-base": TONES.base,
            "--co-a1": TONES.accent1,
            "--co-a2": TONES.accent2,
            "--co-a3": TONES.accent3,
            "--co-dur": "4s",
            width: dimension,
            height: dimension,
            flexShrink: 0,
          } as React.CSSProperties
        }
      />

      {/* @property と @keyframes はグローバルでなければ効かない */}
      <style jsx global>{`
        @property --co-angle {
          syntax: "<angle>";
          inherits: false;
          initial-value: 0deg;
        }
        @keyframes co-spin {
          to {
            --co-angle: 360deg;
          }
        }
      `}</style>

      {/* オーブ本体のスタイル（コンポーネント内に閉じる） */}
      <style jsx>{`
        .co-orb {
          position: relative;
          border-radius: 50%;
          box-shadow: 0 0 8px oklch(55% 0.22 145 / 0.35);
        }
        .co-orb::before {
          content: "";
          position: absolute;
          inset: 0;
          border-radius: 50%;
          background:
            conic-gradient(
              from var(--co-angle),
              var(--co-a1),
              var(--co-a2),
              var(--co-base),
              var(--co-a3),
              var(--co-a1)
            ),
            conic-gradient(
              from calc(var(--co-angle) + 60deg),
              var(--co-a2),
              var(--co-base),
              var(--co-a3),
              var(--co-a1),
              var(--co-a2)
            ),
            conic-gradient(
              from calc(var(--co-angle) + 120deg),
              var(--co-a3),
              var(--co-a1),
              var(--co-a2),
              var(--co-base),
              var(--co-a3)
            ),
            conic-gradient(
              from calc(var(--co-angle) + 180deg),
              var(--co-base),
              var(--co-a3),
              var(--co-a1),
              var(--co-a2),
              var(--co-base)
            ),
            conic-gradient(
              from calc(var(--co-angle) + 240deg),
              var(--co-a1),
              var(--co-a2),
              var(--co-a3),
              var(--co-base),
              var(--co-a1)
            ),
            conic-gradient(
              from calc(var(--co-angle) + 300deg),
              var(--co-a2),
              var(--co-base),
              var(--co-a1),
              var(--co-a3),
              var(--co-a2)
            );
          filter: blur(4px) contrast(1.3);
          animation: co-spin var(--co-dur) linear infinite;
        }
        .co-orb::after {
          content: "";
          position: absolute;
          inset: 0;
          border-radius: 50%;
          background: radial-gradient(
              circle at 30% 30%,
              oklch(85% 0.04 145) 1px,
              transparent 1px
            )
            0 0 / 4px 4px;
          mix-blend-mode: overlay;
          opacity: 0.4;
        }
        @media (prefers-reduced-motion: reduce) {
          .co-orb::before {
            animation: none;
          }
        }
      `}</style>
    </>
  );
}

// ── DockBar ────────────────────────────────────────────────────────────────

function DockBar({ onOpen }: { onOpen: () => void }) {
  return (
    <motion.button
      type="button"
      initial={{ opacity: 0 }}
      animate={{
        opacity: 1,
        transition: { delay: 0.22, duration: 0.15 },
      }}
      exit={{ opacity: 0, transition: { duration: 0.08 } }}
      className="flex w-full items-center gap-3 px-5 text-left transition-colors hover:bg-canvas/70"
      style={{ height: DOCK_HEIGHT }}
      onClick={onOpen}
      aria-label="AIでたたき台を作成"
    >
      <ColorOrb dimension={22} />
      <span className="text-sm font-medium text-ink">AIでたたき台を作成</span>
      <span className="ml-auto hidden text-xs text-ink-muted sm:inline">
        クリックして案件概要を入力
      </span>
    </motion.button>
  );
}

// ── InputForm ──────────────────────────────────────────────────────────────

interface InputFormProps {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void | Promise<void>;
  pending: boolean;
  error?: string | null;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
}

function InputForm({
  value,
  onChange,
  onSubmit,
  pending,
  error,
  textareaRef,
}: InputFormProps) {
  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      if (!pending && value.trim()) void onSubmit();
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{
        opacity: 1,
        transition: { delay: 0.1, duration: 0.2 },
      }}
      exit={{ opacity: 0, transition: { duration: 0.08 } }}
      className="flex h-full flex-col gap-3 p-5"
    >
      <div className="flex items-center gap-2">
        <ColorOrb dimension={20} />
        <span className="text-sm font-semibold text-ink">案件概要</span>
      </div>

      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="例：中小企業向けの予約管理Webアプリを新規開発。要件定義・デザイン・実装・3ヶ月運用保守まで。"
        aria-label="案件概要"
        className={cn(controlClass, "flex-1 resize-none bg-canvas py-2.5")}
      />

      <div className="flex items-center justify-between gap-3">
        <span className="hidden text-xs text-ink-muted sm:inline">
          ⌘+Enter で送信
        </span>
        <div className="flex items-center gap-3">
          {error && (
            <span role="alert" className="text-xs text-danger">
              {error}
            </span>
          )}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={pending || !value.trim()}
            onClick={() => void onSubmit()}
          >
            {pending ? "生成中…" : "AIでたたき台を作成"}
          </Button>
        </div>
      </div>
    </motion.div>
  );
}

// ── AiOrbPanel ─────────────────────────────────────────────────────────────
// DockBar（閉じた細長いボタン）をクリックするとバネで広がり、InputForm（開いたカード）になる。
// 外側のクリックか Esc で閉じる。生成がエラーなく終わったときも自動で閉じる。

export function AiOrbPanel({
  value,
  onChange,
  onSubmit,
  pending,
  error,
}: AiOrbPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const prevPendingRef = useRef(false);

  useEffect(() => {
    if (prevPendingRef.current && !pending && !error) {
      setIsOpen(false);
    }
    prevPendingRef.current = pending;
  }, [pending, error]);

  useEffect(() => {
    if (!isOpen) return;
    function handle(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    function handle(e: KeyboardEvent) {
      if (e.key === "Escape") setIsOpen(false);
    }
    document.addEventListener("keydown", handle);
    return () => document.removeEventListener("keydown", handle);
  }, [isOpen]);

  // 広がるアニメーションが進んでから入力欄にフォーカスする
  useEffect(() => {
    if (isOpen) {
      const t = setTimeout(() => textareaRef.current?.focus(), 150);
      return () => clearTimeout(t);
    }
  }, [isOpen]);

  return (
    <div ref={containerRef}>
      <motion.div
        animate={{
          height: isOpen ? PANEL_HEIGHT : DOCK_HEIGHT,
          borderRadius: isOpen ? PANEL_RADIUS : DOCK_RADIUS,
        }}
        transition={{ type: "spring", stiffness: 280, damping: 30 }}
        className="w-full overflow-hidden border border-line bg-surface"
      >
        <AnimatePresence>
          {!isOpen && <DockBar key="dock" onOpen={() => setIsOpen(true)} />}
        </AnimatePresence>

        <AnimatePresence>
          {isOpen && (
            <InputForm
              key="form"
              value={value}
              onChange={onChange}
              onSubmit={onSubmit}
              pending={pending}
              error={error}
              textareaRef={textareaRef}
            />
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
