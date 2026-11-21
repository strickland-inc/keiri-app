import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AppShell } from "@/components/app-shell";
import { IconFontGate } from "@/components/icon-font-gate";
import { redirect } from "next/navigation";
import { loadSession } from "@/lib/session";
import { getRepositories } from "@/repositories";
import { loadCompanyContext } from "@/lib/active-company";
import type { Issuer } from "@/domain/issuer";

export const metadata: Metadata = {
  title: "KEIRI",
  description:
    "請求書・見積書・納品書・発注書・領収書の作成・PDF出力と、経費・損益計算書・貸借対照表の管理",
  // 経理データのため検索エンジンにインデックスさせない
  robots: { index: false, follow: false, nocache: true },
  appleWebApp: { capable: true, title: "KEIRI", statusBarStyle: "default" },
  icons: { icon: "/icon-192.png", apple: "/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  themeColor: "#00ac3a",
  width: "device-width",
  initialScale: 1,
  // ホーム画面起動時にノッチ/ステータスバー下まで描画
  viewportFit: "cover",
};

/**
 * 会社の一覧はシェル（切替UI）のためだけに読む。
 * ここで落ちるとログイン画面まで巻き添えになるので、失敗しても空で描く。
 */
async function loadCompaniesForShell(): Promise<{
  companies: Issuer[];
  activeCompanyId: string | null;
}> {
  try {
    const repos = await getRepositories();
    const ctx = await loadCompanyContext(repos);
    return {
      companies: ctx.companies,
      activeCompanyId: ctx.active?.id ?? null,
    };
  } catch {
    return { companies: [], activeCompanyId: null };
  }
}

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const { session, stale } = await loadSession();
  // 消されたユーザーの Cookie は、ログアウトの経路で片付けて、ログイン画面へ戻す。
  if (stale) redirect("/logout");
  // ログイン前（ログイン画面）は会社を読まない。スプレッドシートへの通信を増やさないため。
  const { companies, activeCompanyId } = session
    ? await loadCompaniesForShell()
    : { companies: [], activeCompanyId: null };

  return (
    <html lang="ja" className="h-full antialiased">
      <head>
        {/* アイコンフォントを早めに取得して、アイコンが出るまでの待ちを短くする */}
        <link
          rel="preload"
          href="/fonts/material-symbols.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
      </head>
      <body className="min-h-full bg-surface text-ink">
        <AppShell
          isAdmin={session?.role === "admin"}
          companies={companies}
          activeCompanyId={activeCompanyId}
        >
          {children}
        </AppShell>
        <IconFontGate />
      </body>
    </html>
  );
}
