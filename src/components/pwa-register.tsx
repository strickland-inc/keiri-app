"use client";

import { useEffect } from "react";

/** Service Worker を登録する（PWA インストール／プッシュ通知の前提）。 */
export function PwaRegister(): null {
  useEffect(() => {
    if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // 登録失敗（非対応ブラウザ等）は無視
      });
    }
  }, []);
  return null;
}
