"use client";

import { useEffect } from "react";

/**
 * Material Symbols の読込完了を html.icons-ready で知らせる。
 * 読込前はアイコン名の英字が見えて崩れるため、globals.css 側で非表示にしている。
 * フォント取得に失敗しても 3 秒後には表示へ切り替える。
 */
export function IconFontGate() {
  useEffect(() => {
    const root = document.documentElement;
    const ready = () => root.classList.add("icons-ready");
    const timer = window.setTimeout(ready, 3000);
    document.fonts
      .load("1em 'Material Symbols Outlined'")
      .catch(() => undefined)
      .finally(() => {
        window.clearTimeout(timer);
        ready();
      });
    return () => window.clearTimeout(timer);
  }, []);
  return null;
}
