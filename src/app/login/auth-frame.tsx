import type { ReactNode } from "react";

/** 未ログインの画面の外枠。画面の中央に、幅 360〜420px で置く。 */
export function AuthFrame({
  title,
  wide,
  children,
}: {
  title: string;
  /** 回復コードなど、少し幅が要る画面。 */
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-4 py-10">
      <div className={wide ? "w-full max-w-[420px]" : "w-full max-w-[360px]"}>
        <h1 className="mb-6 text-center text-2xl font-semibold tracking-tight">
          {title}
        </h1>
        {children}
      </div>
    </div>
  );
}
