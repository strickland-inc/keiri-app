@AGENTS.md

# keiri-app

経理アプリ。請求書・見積書・納品書・発注書・領収書を作成・採番・PDF 出力・管理し、経費・売上・銀行明細を記録して、会計帳簿、決算資料、freee 取込 CSV まで出す。データは Google Sheets に持ち、Repository 抽象越しに後で DB へ差し替えられる。ホスティングは Cloudflare Workers（vinext 経由）。

複数の会社の帳簿を 1 つのアプリで分けて持つ。帳票・売上・経費・レポート・会計帳簿・決算・ホームは、サイドバーで選んだ会社に追従する。

- `AGENTS.md` … Next.js 16 の注意。コードを書く前に読む
- `DESIGN.md` … デザインシステム
- `.claude/skills/expense-classification/` … 費目の分類基準

## Stack

Next.js 16（App Router / Turbopack / src-dir）, React 19, TypeScript, Tailwind v4。
Google Sheets（`src/lib/google/rest.ts` = fetch + Web Crypto の軽量クライアント）/ PDF（`@react-pdf/renderer` をブラウザで実行 + `public/fonts` の Noto Sans JP）/ AI（`@google/genai` = Gemini 2.5 Flash、銀行明細は TypeSafe の Jev）/ 認証（PBKDF2 + HMAC Cookie。旧 bcrypt も照合）/ アイコン（Material Symbols）。

## 守ること

### データ層

- `src/repositories/index.ts` の `getRepositories()` が唯一の分岐点。Sheets の環境変数が揃えば Google Sheets、無ければ InMemory（デモデータ）。UI と API は `src/repositories/types.ts` のインターフェースだけに依存し、実体を直接 import しない。
- Repository にメソッドを足すときは、`memory.ts` と `sheets/index.ts` の両方に入れる。
- Sheets の列を増やすときは、`schema.ts` の `*_HEADERS` の**末尾**に足す。途中に挿入すると既存データの意味がずれる。既存タブのヘッダー行は自動で更新されない。
- `readAll` が読む範囲は `A:Z`（26 列）。`updateRowById` / `deleteRowById` は 1 列目を id とみなす。
- サービスアカウントは新規スプレッドシートを作れない。ユーザーが作って、サービスアカウントに編集者として共有する（`scripts/setup-sheets.mjs`）。
- `.env.local` に Sheets の資格情報があると、`npm run dev` はそのスプレッドシートに書き込む（タブとカウンター行を作る）。デモデータで動かすときは `SHEETS_SPREADSHEET_ID= GOOGLE_PRIVATE_KEY= npm run dev`。`GOOGLE_SERVICE_ACCOUNT_EMAIL` は空にしない（zod の email 検証で落ちる）。

### 認証

- `src/lib/auth.ts`（セッション。Edge 互換）と `src/lib/auth-server.ts`（資格の照合。サーバー専用）を分ける。`src/proxy.ts` が import してよいのは `lib/auth.ts` だけ。
- 管理者は環境変数 `APP_LOGIN_ID` / `APP_LOGIN_PASSWORD`。発行したユーザーは Sheets の `users` に PBKDF2 のハッシュで持つ。`bcryptjs` は旧ハッシュの照合だけに使い、新しく使わない。
- 本番で `AUTH_SECRET` が無い、または 16 文字未満なら動かさない。検査は `lib/auth.ts` の `authSecretProblem` の 1 か所で、`proxy.ts`（全リクエストを 500 で断る）・`instrumentation-node.ts`（起動時に終了）・`createSession` / `verifySession` が使う。外さない。
- 会計データなので、`robots=noindex` で検索から外す。

### 会社の切り替え

- `issuers` が「会社」そのもの。選択は Cookie `keiri_company`（`src/lib/active-company.ts` の `loadCompanyContext()` / `companyScope()`）、切替 UI は `src/components/company-switcher.tsx`。画面で会社別に絞るときは、Repository の `list()` に `companyScope(ctx)` を渡す。
- 会社ごとに絞る: 帳票・売上台帳・経費・レポート・ホーム・会計帳簿・決算。
- 会社をまたぐ: お金コーチ・プッシュ通知・お金の API。本人のお金を見る面なので、会社別にしない。
- 会社の列が無い: 銀行明細。会社が未設定のデータと同じ扱いにして、既定の会社を見ているときだけ仕訳に入れる。
- 共有: 取引先。
- 会社スコープの導入前の経費は `issuerId` が空のまま、既定の会社を見ているときだけ表示される。一括で埋める処理は足さない。
- 帳票の作成フォームで発行元を選ばせない。作成時は選択中の会社、編集時は属している会社で固定する（`documents/actions.ts`）。別会社を選ぶと、作った直後に一覧から消えたように見える。

### 採番

会社ごと・帳票種別ごとの通し連番（`0001`…、`src/domain/numbering.ts`）。カウンターは Sheets の `counters` タブの `<issuerId>:<帳票種別>` 行で、番号は作成時に確定する。同じ規則が `scripts/keiri.mjs` にもあるので、変えるときは両方を同時に直す。

### 金額・税

`src/domain/money.ts` の `summarize()` が税率別に集計する。金額は円・整数で扱い、浮動小数を持ち込まない。

### PDF と帳票シート

- `@react-pdf/renderer` はブラウザで実行する（`src/lib/pdf/browser.ts`）。サーバーで描くと Workers の CPU 上限を超える。
- 帳票シートがある書類だけ、`/api/documents/[id]/pdf` が Google 側で PDF に書き出して返す。帳票シートは作成時の発行元の値で作られ、あとから発行元を変えても書き換わらない。
- 帳票シートの環境変数は `DOCUMENT_TEMPLATE_SPREADSHEET_ID`（未設定ならシートを作らない）、`DOCUMENT_TEMPLATE_SHEET_ID`、`DOCUMENT_OUTPUT_FOLDER_ID`。
- PDF のファイル名は `buildDocumentPdfFilename`（`src/lib/documents/pdfFilename.ts`）が唯一の定義: `種別_件名_取引先_発行日(YYYYMMDD)_番号.pdf`。

### エージェント API

- 読取と書込は別のトークンで認可する（`AGENT_READ_TOKEN` / `AGENT_WRITE_TOKEN`）。トークンが未設定なら通さない。
- 返すのは集計済みの `MoneySnapshot` だけ。生の支出明細は返さない。
- 書き込み（`/api/agent/v1/money/write`）は、呼び出す側のエージェントが利用者の承認を取ってから送る前提。サーバーはトークン・項目の許可リスト・楽観ロック・冪等キーで守る。
- お金の API を変えたら `npm run verify:money-coach` を通す。

### Cloudflare Workers

- 使うのは Workers と静的アセットだけ。KV / D1 / R2 / Images / Queues / Durable Objects / Browser Run などの課金対象は使わず、`cloudflare.config.ts` に宣言しない。
- 無料プランの上限は、CPU 10ms/リクエスト、外部通信 50 回/リクエスト、1 日 10 万リクエスト。PDF の描画や bcrypt のような重い処理をサーバーに置かない。複数行の追加は `appendRows` の 1 回にまとめ、同じ瞬間の読み取りは `values:batchGet` 1 回にまとめる（`src/lib/coalesce.ts`）。
- 無料プランの CPU 10ms は、画面によっては超える。短時間に続けてアクセスすると HTTP 503 で一部が失敗することがある。CPU を減らす変更は歓迎するが、増やす変更は避ける。
- ルートレイアウトは会社一覧を読むが、ログイン前（セッション無し）は読まない。
- Node 専用の `googleapis` / `web-push` は `src/` で使えない。`src/lib/google/rest.ts` と `src/lib/webpush.ts` を使う。`scripts/` のローカル専用 CLI は、devDependency の `googleapis` を使ってよい。
- 秘密情報は、`cloudflare.config.ts` の `SECRET_NAMES` にある名前だけがデプロイ時に同梱される。アプリが新しい環境変数を読むようにしたら、ここと `.env.example` に足す。

### アイコン

Material アイコンだけを使う（`<Icon name="home" className="text-[20px]" />`、`src/components/ui/icon.tsx`）。背景に丸や角丸を付けない。フォントは使うアイコンだけを含む小さなファイル（`public/fonts/material-symbols.woff2`）を自前で配信する。新しいアイコン名を使ったら `npm run icons` で作り直してコミットする。`npm run icons:check` で不足を検出できる。

### UI

トークンと部品は `DESIGN.md` が正。画面ごとに class 文字列をコピペせず、`src/components/ui/` の部品を使う。色は #hex を直書きせず、トークンを使う。画面を足したら、メニュー（`src/components/nav/nav-config.ts`）にも足す。

### テスト

`node --test` は型だけを外して実行するので、`src/domain/` で値を import する相対パスには `.ts` を付ける（`import { summarize } from "./money.ts"`）。`import type` には要らない。

## 画面と API

- 画面: `/`, `/documents`（+`/new` `/new?copyFrom=<id>` `/[id]` `/[id]/edit`）, `/revenues`, `/expenses`（+`/scan`）, `/bank`, `/accounting/{bs,pl,monthly,journal,ledger}`, `/closing`, `/reports`, `/coach`, `/parties`, `/issuers`, `/settings`, `/login`, `/admin`
- API: `/api/documents/[id]/pdf`, `/api/ai/{estimate,finance-advice}`, `/api/bank/{parse,classify}`, `/api/closing/{freee-csv,trial-balance}`, `/api/expenses/scan`, `/api/push/*`, `/api/agent/v1/{documents,issuers,money}/*`

## 機能のメモ

- 会計帳簿（`src/domain/accounting.ts`）… 請求書と経費から自動仕訳を作り、開くたびに集計する。前提（入金日・引落日・税込経費・期首残高 0）はファイル冒頭にある。期首の月は、会社の決算月（`fiscalYearEndMonth`）の翌月。無ければ設定 `fiscal_start_month`（既定 1）。
- 決算資料と freee 取込 CSV（`/closing`）… 会社の決算月と第 1 期の期末日から、期ごとの売上高・販管費・月別カバレッジ・要確認の経費を集計する（`src/domain/closing.ts`、CSV は `src/lib/closing/`）。売上は請求書と売上台帳（`revenues` タブ）の両方から作る。
- 銀行明細（`/bank`）… 銀行名の指定なしで CSV をアップロードする。`domain/bank.ts` が文字コード・区切り・列を自動判定し、見出しで決まらなければ Jev が列の役割を答える。仕訳（`lib/bank-classifier.ts`）は、入金を未入金の請求書へ照合し、確認済みの同じ摘要は科目を再利用し、残りは Jev が科目を選ぶ（確信度 0.8 未満は要確認）。Jev が使えないときは仮受金・仮払金で取り込みを止めない。銀行口座は 1 口座ずつの運用を前提とする。
- Jev は TypeSafe（`https://api.typesafe.ai/v1/systemone`）。環境変数は `TYPESAFE_API_KEY`（必須）と `TYPESAFE_MODEL`（既定 `jev-latest`）。
- 日付の整形は `src/domain/dates.ts`、税率の読み取りは `parseTaxRate`、`searchParams` の先頭値は `src/lib/search-params.ts` の `firstParam`、スクリプトの `.env.local` の読み込みは `scripts/env-local.mjs`。同じ処理を画面ごとに書き直さない。

## 禁止

| 禁止                                                                              | 理由                                                 | 代わりに                                                                              |
| --------------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `middleware.ts` を作る                                                            | Next 16 で廃止                                       | `src/proxy.ts`（`export function proxy`）                                             |
| `params` / `searchParams` / `cookies()` を同期で読む                              | Next 16 で Promise                                   | `await` する                                                                          |
| proxy から `auth-server` / `repositories` を import                               | Edge に Node 専用の処理と Sheets 通信が載る          | proxy は `auth.ts` だけ                                                               |
| UI や API から実体リポジトリを直接 import                                         | データ層の差し替えが壊れる                           | `getRepositories()` 経由                                                              |
| `src/` の実行時コードで `googleapis` / `web-push` を使う、`bcryptjs` を新しく使う | Workers で動かない・CPU 上限を超える                 | `lib/google/rest.ts` / `lib/webpush.ts` / PBKDF2（`bcryptjs` は旧ハッシュの照合だけ） |
| 採番のロジックを画面側だけ直す                                                    | CLI と二重管理。同じ番号を二重に振る                 | `repositories/scope.ts` と `scripts/keiri.mjs` を同時に直す                           |
| 帳票の作成フォームで発行元を選ばせる                                              | 別会社の帳票が作った直後に一覧から消えたように見える | 選択中の会社で固定（`documents/actions.ts`）                                          |
| 認証情報をコード・チャット・コミットに書く                                        | 漏洩                                                 | `.env.local` / `.dev.vars` / Cloudflare のシークレット                                |
| 本番で `AUTH_SECRET` の検査を外す・既定値で動かす                                 | 誰でも Cookie を偽造してログインできる               | `lib/auth.ts` の `authSecretProblem` を通す                                           |
| lucide 等のアイコン、アイコンに色付き背景                                         | 統一性・視覚ノイズ                                   | `Icon`（Material）、色とサイズのみ                                                    |
| `#hex` の直書き                                                                   | テーマ崩れ                                           | `brand-*` / `ink` / `line` などのトークン                                             |
| `docs/` を置く                                                                    | 置いた文書はどこからも読まれない                     | 従う決まりは `CLAUDE.md`、使う人向けの説明は `README.md`                              |

## コマンド

- `npm ci` … 依存の取得（これをしないと `npx tsc` が別の `tsc` パッケージを取りに行く）
- `npm run dev` … 開発
- `npm run build` … 本番ビルド（型チェック込み）。`npx tsc --noEmit` で型だけ見る
- `npm run lint` / `npm run format` / `npm run format:check`
- `npm test` … `src/**/*.test.ts` と `scripts/**/*.test.mjs` の全テスト
- `npm run test:accounting` … 会計・書類コピー・銀行 CSV・Jev 仕訳・Google REST・Web Push・決算・freee CSV・会社スコープのテスト
- `npm run verify:money-coach` … お金コーチ・エージェント API のテスト + ビルド
- `npm run icons` / `npm run icons:check` … アイコン用フォントの再生成 / 不足の検出
- `npm run dev:vinext` / `npm run build:vinext` / `npm run start:vinext` … Workers 実行環境（workerd）でローカル確認（`.dev.vars` に秘密情報。git 管理外）
- `npm run deploy`（= `node scripts/deploy-cloudflare.mjs [--dry-run]`）… Cloudflare へデプロイ。先に `npx cf auth login`。秘密情報は環境変数と `.env.local` から `SECRET_NAMES` の分だけ集めて同梱する（値は表示しない）
- `node scripts/set-cloudflare-secrets.mjs [--dry-run] [--worker 名前]` … ログイン情報・`AUTH_SECRET`・Jev/Gemini キーを対話入力して Worker に登録（先に `npx wrangler login`）
- `node scripts/set-agent-documents-token.mjs [--worker 名前]` … 書類作成 API のトークンを作って Worker に登録
- `node scripts/setup-sheets.mjs <JSON キー> <スプレッドシートの URL か ID>` … 共有済みのスプレッドシートに届くか確かめ、`.env.local` に Sheets の設定を書く
- `node scripts/import-rakuten.mjs import <csv>` / `node scripts/import-paypay.mjs <csv>` … カード明細を取り込んで費目を仕分ける
- `npm run keiri -- clients list --json` … CLI。書き込みは `--execute` を付けたときだけ
- `node scripts/freee.mjs <コマンド>` … freee 会計 API の CLI（ローカル専用。使い方はファイル冒頭。`FREEE_CLIENT_ID` / `FREEE_CLIENT_SECRET` は環境変数か `.env.local`。書き込みは `post-bank-rows --execute` だけ）

## 書類作成 API（エージェント用）

`/api/agent/v1/documents`（`Authorization: Bearer <AGENT_DOCUMENTS_TOKEN>`）。`GET` は取引先・発行元・書類の一覧、`POST` は書類の作成（`?dryRun=1` で確認だけ）。削除と取引先の変更はできない。発行元（会社）は `issuerId` で指定し、省略すると既定の会社になる。同じ会社・種類・取引先・発行日・件名の書類は二重に作らず、既存の id を返す。入力の検証は `src/lib/documents/agent-request.ts`。

- `GET` は、発行元の住所・振込先の値を返さず、入っているかだけ（`hasAddress` / `hasBankInfo`）を返す。取引先は名前と敬称だけを返す。
- `PATCH /api/agent/v1/issuers/[id]` … 発行元の `postalCode` / `address` / `building` / `phone` / `email` / `registrationNumber` / `bankInfo` だけを更新する（名称・既定・印影は不可。空文字でその項目を空にする）。帳票シートは作成時の値で作られるので、請求書を作る前に更新する。検証は `src/lib/documents/agent-update.ts`。
- `POST /api/agent/v1/documents/[id]/void` … 書類を「無効」にする（削除はしない。番号は欠番）。下書き・発行済み・送付済みだけ可能で、入金済みは不可。
- `dryRun=1` の結果には税込合計が出ない。利用者に確認を取るときは、`src/domain/money.ts` の `summarize()`（税額は税率ごとに切り捨て）で税込合計を計算して見せる。
- 請求データ（PDF・金額・取引先）をリポジトリにコミットしない。
