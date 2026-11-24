# Next.js 16 の注意

このバージョンの Next.js は、訓練データと API・規約・ファイル構成が異なる。コードを書く前に、`node_modules/next/dist/docs/` の該当するガイドを読む。

- middleware は `src/proxy.ts`（`export function proxy(request)`）。`middleware.ts` は作らない。
- `page.tsx` の `params` / `searchParams` は Promise（`const { id } = await params`）。
- `cookies()` は async（`await cookies()`）。
- データ変更は Server Actions（`"use server"` → `revalidatePath` → `redirect`）。
- API route は既存に合わせて `export const runtime = "nodejs"` を付ける。

## 認証とアカウントの決まり

- Server Action の最初で、`assertSession()` か `assertAdmin()` を呼ぶ。
- 未ログインで開く画面は、`src/proxy.ts` の公開パスに足す。
- 1 つの行を書くのは、1 種類の書き手だけにする。`users` は作成時と役割の変更、`user_profiles` は Cookie だけで書ける項目、`user_security` はパスワードの再入力・リンク・接続コードを通した操作だけ、`user_access` は管理者だけ、`session_versions` は `nextSeq` で増やすだけ。
- 各ページ（`page.tsx`）の最初で、`requirePageSession()` を呼ぶ。
- ロックは、パスワードやコードを照合する前に数える。
- 画面に説明文を置かない（`DESIGN.md`）。
- 新しいタブへの書き込みは、`upsertById` を使う。行が無い既存の利用者に `updateById` を送ると、落ちる。
- 一度きりの操作と回数は、書く前に `nextSeq` を呼び、返った値で決める。
- 保存した操作は、`recordAudit` で残す。`summary` に、パスワード、トークン、接続コード、回復コード、TOTP の秘密を入れない。
- `apps-script/Code.gs` を変えると、利用者に Apps Script の貼り直しと再デプロイが要る。変えない形で組む。
- `src/lib/auth.ts` は `proxy.ts` が読む。Repository や Node 専用の依存を入れない。

デザインは `DESIGN.md` を参照。
