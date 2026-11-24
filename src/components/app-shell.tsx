"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { logout } from "@/app/login/actions";
import { Icon } from "@/components/ui/icon";
import { buttonVariants } from "@/components/ui/button";
import { NavTree } from "@/components/nav/nav-tree";
import { CompanySwitcher } from "@/components/company-switcher";
import type { Issuer } from "@/domain/issuer";
import { cn } from "@/lib/utils";

/** サイドバーの下に出す、ログイン中の人。 */
export interface ShellUser {
  displayName: string;
  loginId: string;
}

/** ログインしていない人が開く画面。シェル（メニュー）なしで描く。 */
function isBarePath(pathname: string): boolean {
  return (
    pathname === "/login" ||
    pathname.startsWith("/login/") ||
    pathname === "/setup" ||
    pathname === "/recover" ||
    pathname.startsWith("/invite/") ||
    pathname.startsWith("/reset/")
  );
}

interface AppShellProps {
  children: React.ReactNode;
  isAdmin: boolean;
  user: ShellUser | null;
  /** 切替に出す会社の一覧。ログイン前や取得に失敗した場合は空で来る。 */
  companies: Issuer[];
  activeCompanyId: string | null;
}

interface SidebarContentProps {
  isAdmin: boolean;
  user: ShellUser | null;
  companies: Issuer[];
  activeCompanyId: string | null;
  onNavigate?: () => void;
}

/** URL（パスとクエリ）を読むメニュー。useSearchParams は Suspense 配下で使う。 */
function SidebarNav({
  isAdmin,
  onNavigate,
}: {
  isAdmin: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const query = useSearchParams();
  return (
    <NavTree
      pathname={pathname}
      query={query}
      isAdmin={isAdmin}
      onNavigate={onNavigate}
    />
  );
}

/** サイドバーの中身（PC の固定表示とモバイルのドロワーで共通）。 */
function SidebarContent({
  isAdmin,
  user,
  companies,
  activeCompanyId,
  onNavigate,
}: SidebarContentProps) {
  return (
    <>
      <Link
        href="/"
        onClick={onNavigate}
        className="px-3 pb-5 pt-1 text-[15px] font-semibold tracking-tight text-ink"
      >
        KEIRI
      </Link>

      {/* 見ている会社。帳票・売上・経費・レポート・決算・ホームがまとめて切り替わる。 */}
      <CompanySwitcher
        companies={companies}
        activeId={activeCompanyId}
        className="mb-3"
      />

      <Link
        href="/documents/new"
        onClick={onNavigate}
        className={cn(buttonVariants({ variant: "secondary" }), "mb-5 w-full")}
      >
        <Icon name="add" className="text-[18px]" />
        書類を作成
      </Link>

      <div className="-mx-1 flex-1 overflow-y-auto px-1">
        <Suspense fallback={null}>
          <SidebarNav isAdmin={isAdmin} onNavigate={onNavigate} />
        </Suspense>
      </div>

      <div className="mt-3 flex flex-col gap-0.5 border-t border-line pt-3">
        {user && (
          <Link
            href="/account"
            onClick={onNavigate}
            className="flex flex-col rounded-xl px-3 py-2 transition-colors hover:bg-ink/[0.04]"
          >
            <span className="truncate text-sm font-medium text-ink">
              {user.displayName}
            </span>
            <span className="truncate text-xs text-ink-muted">
              アカウント・{user.loginId}
            </span>
          </Link>
        )}
        {/* ログアウトは POST にする。GET だと、よそのページに置かれたリンクや画像から勝手にログアウトさせられる */}
        <form action={logout}>
          <button
            type="submit"
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm text-ink-muted transition-colors hover:bg-ink/[0.04] hover:text-ink"
          >
            <Icon name="logout" className="text-[20px]" />
            ログアウト
          </button>
        </form>
      </div>
    </>
  );
}

export function AppShell({
  children,
  isAdmin,
  user,
  companies,
  activeCompanyId,
}: AppShellProps) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) =>
      e.key === "Escape" && setDrawerOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  // ログイン前の画面はシェル（メニュー）無しでフル表示
  if (isBarePath(pathname)) return <>{children}</>;

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col bg-canvas p-3 md:flex">
        <SidebarContent
          isAdmin={isAdmin}
          user={user}
          companies={companies}
          activeCompanyId={activeCompanyId}
        />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* モバイル用トップバー */}
        <header className="sticky top-0 z-30 border-b border-line bg-surface/90 backdrop-blur md:hidden">
          <div className="flex items-center justify-between px-3 py-2">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label="メニューを開く"
              className={buttonVariants({ variant: "ghost", size: "icon" })}
            >
              <Icon name="menu" className="text-[22px]" />
            </button>
            <Link href="/" className="text-[15px] font-semibold tracking-tight">
              KEIRI
            </Link>
            <Link
              href="/documents/new"
              aria-label="書類を作成"
              className={buttonVariants({ variant: "ghost", size: "icon" })}
            >
              <Icon name="add" className="text-[22px]" />
            </Link>
          </div>
          {/* 見ている会社はどの画面でも分かるように、モバイルでも常に出す。 */}
          {companies.length > 1 && (
            <div className="px-3 pb-2">
              <CompanySwitcher
                companies={companies}
                activeId={activeCompanyId}
              />
            </div>
          )}
        </header>

        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 md:px-10 md:py-12">
          {children}
        </main>
      </div>

      {/* モバイル用ドロワー */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            type="button"
            aria-label="メニューを閉じる"
            onClick={() => setDrawerOpen(false)}
            className="absolute inset-0 bg-ink/30"
          />
          <aside className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-canvas p-3 shadow-[var(--shadow-pop)]">
            <SidebarContent
              isAdmin={isAdmin}
              user={user}
              companies={companies}
              activeCompanyId={activeCompanyId}
              onNavigate={() => setDrawerOpen(false)}
            />
          </aside>
        </div>
      )}
    </div>
  );
}
