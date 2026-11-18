"use client";

import { useState, useEffect, useCallback, useSyncExternalStore } from "react";
import { Icon } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";

/** VAPID 公開鍵（URL-safe base64）を、pushManager.subscribe が受け取るバイト列に直す。 */
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const output = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    output[i] = rawData.charCodeAt(i);
  }
  return output;
}

type PermissionState = "default" | "granted" | "denied";

function isPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "Notification" in window &&
    "serviceWorker" in navigator &&
    "PushManager" in window
  );
}

function getSupportServerSnapshot(): boolean {
  return false;
}

function getPermissionSnapshot(): PermissionState {
  return isPushSupported()
    ? (Notification.permission as PermissionState)
    : "default";
}

function getPermissionServerSnapshot(): PermissionState {
  return "default";
}

// 対応状況と許可状態は useSyncExternalStore で読む。サーバー描画時の値を別に返して、
// ハイドレーションの不一致を避けるため。変化の購読は不要なので何もしない。
function subscribeToNothing(): () => void {
  return () => {};
}

export function PushToggle(): React.ReactElement {
  const supported = useSyncExternalStore(
    subscribeToNothing,
    isPushSupported,
    getSupportServerSnapshot,
  );
  const permission = useSyncExternalStore(
    subscribeToNothing,
    getPermissionSnapshot,
    getPermissionServerSnapshot,
  );
  const [subscribed, setSubscribed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [testSent, setTestSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supported || permission !== "granted") return;
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => {
        setSubscribed(sub !== null);
      })
      .catch(() => {});
  }, [supported, permission]);

  const subscribe = useCallback(async () => {
    const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!vapidKey) {
      setError("VAPID公開鍵が設定されていません");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const result = await Notification.requestPermission();
      if (result !== "granted") {
        setError("通知の許可が得られませんでした");
        return;
      }

      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey),
      });

      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub.toJSON()),
      });

      if (!res.ok) {
        throw new Error("購読の保存に失敗しました");
      }

      setSubscribed(true);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "購読に失敗しました");
    } finally {
      setLoading(false);
    }
  }, []);

  const unsubscribe = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await sub.unsubscribe();
        await fetch("/api/push/unsubscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
      }
      setSubscribed(false);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "解除に失敗しました");
    } finally {
      setLoading(false);
    }
  }, []);

  const sendTest = useCallback(async () => {
    setLoading(true);
    setError(null);
    setTestSent(false);
    try {
      const res = await fetch("/api/push/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "test" }),
      });
      if (!res.ok) {
        throw new Error("テスト送信に失敗しました");
      }
      setTestSent(true);
      setTimeout(() => setTestSent(false), 3000);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "送信に失敗しました");
    } finally {
      setLoading(false);
    }
  }, []);

  if (!supported) {
    return (
      <Notice icon="notifications_off">
        このブラウザは Web Push に対応していません
      </Notice>
    );
  }

  if (permission === "denied") {
    return (
      <Notice icon="notifications_off">
        通知がブロックされています（ブラウザの設定から許可してください）
      </Notice>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {subscribed ? (
          <>
            <span className="flex items-center gap-1.5 text-sm text-ink-muted">
              <Icon
                name="notifications_active"
                className="text-[18px] text-brand-600"
              />
              通知オン
            </span>
            <Button
              variant="secondary"
              size="sm"
              onClick={sendTest}
              disabled={loading}
            >
              {testSent ? "送信しました" : "テスト送信"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={unsubscribe}
              disabled={loading}
            >
              オフにする
            </Button>
          </>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            onClick={subscribe}
            disabled={loading}
          >
            <Icon name="notifications" className="text-[16px]" />
            {loading ? "処理中…" : "通知をオンにする"}
          </Button>
        )}
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
      <p className="text-xs text-ink-faint">
        iOS は、ホーム画面に追加した PWA でのみ通知が届きます。
      </p>
    </div>
  );
}

function Notice({
  icon,
  children,
}: {
  icon: string;
  children: React.ReactNode;
}) {
  return (
    <p className="flex items-center gap-2 text-sm text-ink-muted">
      <Icon name={icon} className="text-[18px]" />
      {children}
    </p>
  );
}
