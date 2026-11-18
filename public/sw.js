// KEIRI の Service Worker。
// インストール可能性のための fetch ハンドラ（オフラインキャッシュはしない＝常に最新）＋ Web Push。
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// ネットワークそのまま（キャッシュしない）。ハンドラの存在自体がインストール要件。
self.addEventListener("fetch", () => {});

// プッシュ受信 → 通知表示
self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: "KEIRI", body: event.data ? event.data.text() : "" };
  }
  const title = payload.title || "KEIRI";
  const options = {
    body: payload.body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data: { url: payload.url || "/" },
    tag: payload.tag || undefined,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// 通知クリック → アプリを開く（既存ウィンドウがあればフォーカス）
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((list) => {
        for (const client of list) {
          if ("focus" in client) return client.focus();
        }
        return self.clients.openWindow(url);
      }),
  );
});
