<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## このプロジェクトでの Next.js 16 要点

- middleware は `src/proxy.ts`（`export function proxy(request)`）。`middleware.ts` は作らない。
- `page.tsx` の `params` / `searchParams` は **Promise**（`const { id } = await params`）。
- `cookies()` は async（`await cookies()`）。
- データ変更は Server Actions（`"use server"` → `revalidatePath` → `redirect`）。
- API route は既存に合わせて `export const runtime = "nodejs"` を付ける。PDF はサーバーで描かない（`.claude/rules/pdf-and-documents.md`）。

規約は `CLAUDE.md`、デザインは `DESIGN.md`、領域ごとの詳細は `.claude/rules/` を参照。
