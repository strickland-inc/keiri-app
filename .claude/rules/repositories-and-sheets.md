---
description: Repository 抽象と Google Sheets バックエンドの制約。永続化まわりを触るときに読む
paths:
  - "src/repositories/**"
  - "src/lib/sheets/**"
  - "scripts/**"
---

# Repository とバックエンド切替

`getRepositories()`（`src/repositories/index.ts`）が**唯一の分岐点**。
`GOOGLE_SERVICE_ACCOUNT_EMAIL` / `GOOGLE_PRIVATE_KEY` / `SHEETS_SPREADSHEET_ID` が
揃えば Sheets、無ければ InMemory（デモデータ）。

新しい永続化（Supabase 等）を足すときも、ここに分岐を1つ加えるだけで UI と API は無改修。
**この性質を壊さない。** 実体固有の型や挙動を `types.ts` の外へ漏らさない。

InMemory はサーバーレスで揮発する。永続が要る動作確認は Sheets で行う。
InMemory の実体は `globalThis` に 1 つだけ持つ（API ルートと画面でモジュールが別に読まれるため）。

**Repository に新しいメソッドや Repository を足すときは、`memory.ts` と `sheets/index.ts` の両方に入れる。**
片方だけだと、デモと本番で挙動が分かれる。

<important if="Sheets バックエンドに書き込む変更を入れるとき">
`.env.local` に Sheets の資格情報があると、`npm run dev` はそのスプレッドシートに接続する。
本番のデータを入れたスプレッドシートなら、**稼働中の会計データに接続する**。読み取りだけの確認でも
`ensureSheets` が走ってタブとカウンター行を作りにいくため、書き込みが発生する。

InMemory で確認したいときは、Sheets の環境変数を空にして起動する。

```sh
SHEETS_SPREADSHEET_ID= GOOGLE_PRIVATE_KEY= npm run dev
```

`GOOGLE_SERVICE_ACCOUNT_EMAIL` は空にしない。zod の email 検証で落ちる。
</important>

# Google Sheets の制約

- クライアントは `lib/sheets/client.ts` → `lib/google/rest.ts`（fetch + Web Crypto）。Workers で動かない
  `googleapis` を `src/` で使わない（`scripts/` の CLI は使ってよい）
- 同じ瞬間の読み取りは `values:batchGet` 1 回にまとめる（`sheetsApi.readAll` と `lib/coalesce.ts`）。
  複数行の追加は `appendRows` の 1 回にまとめる（Workers の外部通信は 1 リクエスト 50 回まで）

- **サービスアカウントは新規スプレッドシートを作れない。** Drive の保存容量が無いため。
  バックエンド Sheet は**ユーザー所有で作成し、SA へ編集者共有する**。
  `node scripts/setup-sheets.mjs <JSON キー> <スプレッドシート>` が、届くかを確かめて `.env.local` に書く
- タブは初回アクセス時に `ensureSheets` が自動生成する。
  **ヘッダー行を書くのは新規作成したタブだけ**で、既存タブのヘッダーは更新しない

## 列を増やすとき

`schema.ts` の `*_HEADERS` に**末尾で**足す。既存シートの行は列が足りないまま読まれ、
`readAll` が空文字で埋めるので、`opt()` を通せば未設定として扱える。
**途中に挿入すると既存データの意味がずれる。**

既存シートのヘッダー行は自動では更新されない。シートを直接見るなら手で足す。

## 行の読み書き

`readAll` はヘッダー行を落とし、疎な行を列数まで空文字で埋めて返す。読む範囲は `A:Z`（26 列）なので、
26 列を超えるタブを作るときは範囲を広げる。
`updateRowById` / `deleteRowById` は 1 列目を id とみなす。id 以外をキーにしない。
