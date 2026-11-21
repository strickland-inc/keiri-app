# Next.js 16 の注意

このバージョンの Next.js は、訓練データと API・規約・ファイル構成が異なる。コードを書く前に、`node_modules/next/dist/docs/` の該当するガイドを読む。

- middleware は `src/proxy.ts`（`export function proxy(request)`）。`middleware.ts` は作らない。
- `page.tsx` の `params` / `searchParams` は Promise（`const { id } = await params`）。
- `cookies()` は async（`await cookies()`）。
- データ変更は Server Actions（`"use server"` → `revalidatePath` → `redirect`）。
- API route は既存に合わせて `export const runtime = "nodejs"` を付ける。

デザインは `DESIGN.md` を参照。
