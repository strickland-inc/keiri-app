@AGENTS.md

# keiri-app

経理アプリ。請求書・見積書・納品書・発注書・領収書を作成・採番・PDF 出力・管理し、経費・売上・銀行明細を記録して、会計帳簿、決算資料、freee 取込 CSV まで出す。データは **Google Sheets バックエンド**（Repository 抽象越しに、後で DB へ差し替えられる）。ホスティングは **Cloudflare Workers**（vinext 経由）。

**複数の会社の帳簿を1つのアプリで分けて持つ。** 帳票・売上・経費・レポート・会計帳簿・決算・ホームは、サイドバーで選んだ会社に追従する。詳細は `.claude/rules/company-scope.md`。

## See Also

- `AGENTS.md` … **Next.js 16 は訓練データと異なる**。コードを書く前に必読
- `DESIGN.md` … デザインシステム（ブランドの緑を少量だけ使うモノトーン・色・タイポ・部品・アイコン）
- 費目の分類基準は `.claude/skills/expense-classification/`

作業するファイルに応じて `.claude/rules/` が読み込まれる。書く前に該当するものを見る。

| ファイル                     | 内容                                              |
| ---------------------------- | ------------------------------------------------- |
| `architecture.md`            | レイヤリング、依存の向き、金額、画面と API の一覧 |
| `repositories-and-sheets.md` | Repository 抽象、Sheets の制約、列の増やし方      |
| `company-scope.md`           | 会社スコープの線引き、採番（CLI と二重管理）      |
| `auth.md`                    | Edge と Node の分離、セッション、管理者           |
| `pdf-and-documents.md`       | PDF をブラウザで描く理由、帳票シート、ファイル名  |
| `agent-api.md`               | お金の API と書類作成 API の安全境界              |

## Stack

Next.js 16（App Router / Turbopack / src-dir）, React 19, TypeScript, Tailwind v4。
Google Sheets（`src/lib/google/rest.ts` = fetch + Web Crypto の軽量クライアント。`googleapis` は scripts 用の devDependency）/ PDF（`@react-pdf/renderer` を**ブラウザで**実行 + `public/fonts` の Noto Sans JP）/ AI（`@google/genai` = Gemini 2.5 Flash、銀行明細は TypeSafe の Jev）/ 認証（PBKDF2 + HMAC Cookie。旧 bcrypt も照合）/ アイコン（`material-symbols`）。

## 最重要の不変条件

- **データ層の切替**: `src/repositories/index.ts` の `getRepositories()` が**唯一の分岐点**。Sheets の環境変数が揃えば Google Sheets、無ければ InMemory（デモデータ）。UI と API は `src/repositories/types.ts` のインターフェースだけに依存する。実体を直接 import した時点で「後で DB へ差し替える」が壊れる。
- **認証は Edge と Node を分ける**。`src/proxy.ts` が import してよいのは `lib/auth.ts` だけ（`auth.md`）。
- **本番で `AUTH_SECRET` が無い・16 文字未満なら動かさない**。`proxy.ts` が全リクエストを 500 で断り（`authSecretRejection`）、`next start` は `src/instrumentation-node.ts` が起動時に終了させる。この検査を外さない。
- **実行時コードは Workers で動くものだけ**（後述）。`src/` で `googleapis` / `web-push` などの Node 専用ライブラリを使わない。`bcryptjs` は旧ハッシュの照合で `auth-server.ts` が遅延読み込みしているだけで、新しく使わない。

## Routes / Entry Points

- 画面: `/`（ホーム）, `/documents`(+`/new` `/new?copyFrom=<id>`（コピーして作成） `/[id]` `/[id]/edit`), `/revenues`（売上台帳）, `/expenses`(+`/scan`), `/bank`（銀行明細 CSV 取込）, `/accounting/{bs,pl,monthly,journal,ledger}`（会計帳簿）, `/closing`（決算資料・freee 取込 CSV）, `/reports`, `/coach`, `/parties`, `/issuers`（会社）, `/settings`（通知）, `/login`, `/admin`（管理者のみ）
- API: `/api/documents/[id]/pdf`（帳票シートの PDF 中継）, `/api/ai/{estimate,finance-advice}`（Gemini）, `/api/bank/{parse,classify}`（銀行 CSV の読取・Jev 仕訳）, `/api/closing/{freee-csv,trial-balance}`（決算の CSV）, `/api/expenses/scan`, `/api/push/*`, `/api/agent/v1/{documents,issuers,money}/*`（エージェント用）
- `src/proxy.ts` = 認証ガード（旧 middleware）

## Key Conventions

### 会社の切り替え

`issuers` が「会社」そのもの。選択は Cookie `keiri_company`（`src/lib/active-company.ts` の `loadCompanyContext()` / `companyScope()`）、切替 UI は `src/components/company-switcher.tsx`（サイドバー）。画面で会社別に絞るときは、Repository の `list()` に `companyScope(ctx)` を渡す。お金コーチ・通知・お金の API は会社をまたぐ。線引きの理由と既存データの扱いは `company-scope.md`。

### 採番

**会社ごと・帳票種別ごと**の通し連番（`0001`…。`src/domain/numbering.ts`）。Sheets は `counters` タブの `<issuerId>:<帳票種別>` 行で管理（`incrementCounter`）。番号は作成時に確定。同じ規則が `scripts/keiri.mjs`（CLI）にもあるので、変えるときは両方を直す（`company-scope.md`）。

### 金額・税

`src/domain/money.ts` の `summarize()` が税率別に集計（インボイス方式）。金額は**円・整数**で扱う。

### 会計帳簿

実体は `src/domain/accounting.ts`。

請求書と経費から**自動仕訳**を作り、貸借対照表・損益計算書・月次・仕訳帳・総勘定元帳を開くたびに集計する（純関数・DB 追加なし）。前提（入金日・引落日・税込経費・期首残高 0）はファイル冒頭に明記。

- 帳簿は選択中の会社のもの（`src/app/accounting/_lib.ts` が請求書・経費を会社で絞る）。**銀行明細には会社の列が無い**ので、会社が未設定の既存データと同じ扱いにして、既定の会社を見ているときだけ仕訳に入れる。
- 期首の月は、会社に決算月（`fiscalYearEndMonth`）があればその翌月、無ければ設定 `fiscal_start_month`（既定 1）。

### 決算資料と freee 取込 CSV

画面は `/closing`。

会社の決算月と第1期の期末日（`src/domain/fiscal-year.ts`、第n期の期間）から、期ごとの売上高・販管費内訳・月別カバレッジ・要確認の経費を集計する（`src/domain/closing.ts`、読み込みは `src/lib/closing/load-closing.ts`）。CSV は `src/lib/closing/freee-csv.ts`（経費・売上の freee 取込形式）と `trial-balance-csv.ts`（試算表）。CSV の組み立ては `src/lib/closing/csv.ts` にまとめてある。

- 売上台帳（`/revenues`、Sheets `revenues` タブ）は、帳票の無い入金を記録する。決算の売上は請求書と売上台帳の両方から作る。
- freee 会計 API の CLI は `scripts/freee.mjs`（ローカル専用。サーバーでは動かさない）。

### 銀行明細の取り込み

画面は `/bank`。

銀行名の指定なしで CSV をアップロードするだけ。`domain/bank.ts` が文字コード（UTF-8/Shift_JIS）・区切り・列（日付/摘要/入金/出金/残高）を自動判定し、見出しで決まらなければ Jev が列の役割を答える。仕訳は `lib/bank-classifier.ts`: ①入金を未入金の請求書へ照合（複数・手数料差引は Jev が選ぶ）→ ②確認済みの同じ摘要は科目を再利用 → ③Jev が勘定科目を選ぶ（確信度 0.8 未満は「要確認」）。Jev 障害時は仮受金・仮払金で取り込みを止めない。重複は行キーで防ぐ。

- Jev = TypeSafe（`https://api.typesafe.ai/v1/systemone`）。環境変数 `TYPESAFE_API_KEY`（必須）/ `TYPESAFE_MODEL`（既定 `jev-latest`）。`src/lib/jev.ts`
- 銀行明細に残高があれば、最古の取引の前の残高を元入金（期首残高）として会計帳簿に入れる。銀行口座は 1 口座ずつの運用を前提とする（現金預金は 1 科目）。
- InMemory のデータは `globalThis` で共有（API ルートと画面でモジュールが別になるため）。

### メニュー

`src/components/nav/nav-config.ts` が唯一の定義（経理 / 会計 / マスタの構成）。画面を足すときはここに追加する。

### 共通の関数

日付の整形と直近の月の一覧は `src/domain/dates.ts`、税率の読み取りは `src/domain/money.ts` の `parseTaxRate`、`searchParams` の先頭値は `src/lib/search-params.ts` の `firstParam`、スクリプトの `.env.local` の読み込みは `scripts/env-local.mjs`。同じ処理を画面ごとに書き直さない。

### PDF

`@react-pdf/renderer` は**ブラウザで**実行する（`src/lib/pdf/browser.ts`、ボタン `documents/[id]/pdf-download-button.tsx`）。サーバーで描画すると Workers 無料プランの CPU 10ms を大きく超えるため。帳票シートがある書類だけ、`/api/documents/[id]/pdf` が Google 側で PDF に書き出して返す。詳細は `pdf-and-documents.md`。

### Cloudflare Workers の制約

- 使うのは **Workers + 静的アセットだけ**。KV / D1 / R2 / Images / Queues / Durable Objects / Browser Run などの課金対象は**使わない・宣言しない**（`cloudflare.config.ts`）。無料プランは上限を超えるとエラーになるだけで請求されない。
- 無料プランの上限: **CPU 10ms/リクエスト・外部通信 50 回/リクエスト・1 日 10 万リクエスト**。重い処理（PDF 描画、bcrypt、巨大ライブラリ）をサーバーに置かない。外部通信（Sheets/Jev/Gemini）は 1 リクエスト 50 回以内に収める（銀行 CSV の仕訳は 1 回 8 件、Jev は最大 2 回試行。複数行の追加は `appendRows` の 1 回にまとめる）。
- **実測（2026-10）では、無料枠の 10ms を超えている。** ログイン画面（Sheets なし）でも CPU 中央値 14〜22ms、Sheets を読む画面は 20〜45ms。短時間に連続アクセスすると `exceededResources`（HTTP 503）で一部が失敗した（1 割強）。CPU を減らす変更は歓迎するが、増やす変更は避ける。
- Google Sheets の読み取りは、同じ瞬間の要求を `values:batchGet` 1 回にまとめる（`src/lib/coalesce.ts`、`sheetsApi.readAll`）。
- ルートレイアウトはサイドバーの会社切替のために会社一覧を読む。**ログイン前（セッション無し）は読まない**（ログイン画面で Sheets を呼ばないため）。
- Node 専用の `googleapis` / `web-push` は使えない → `src/lib/google/rest.ts`、`src/lib/webpush.ts`（RFC 8291 テストベクトルで検証済み）で置き換え済み。新しい依存を足すときは Workers で動くか確認する。
- 秘密情報は、`cloudflare.config.ts` の `SECRET_NAMES` にある名前だけがデプロイ時に同梱される。アプリが新しい環境変数を読むようにしたら、ここと `.env.example` に足す。

### アイコン

**Material アイコンのみ**。`<Icon name="home" className="text-[20px]" />`（`src/components/ui/icon.tsx`）。lucide 等は使わない。背景に丸/角丸を付けない（DESIGN.md 参照）。

- フォントは**使うアイコンだけを含む小さなファイル**（`public/fonts/material-symbols.woff2`、数 KB）を自前配信する。全部入りの npm パッケージ（約 4MB）は、CSS が参照する `.woff2` がビルド出力に含まれず、本番でアイコンが文字のまま出る原因になった。
- **新しいアイコン名を使ったら `npm run icons`** でフォントとリスト（`material-symbols.names.json`）を作り直してコミットする。`npm run icons:check` で不足を検出できる。

### UI のデザインシステム

モノトーン + 広い余白 + 大きめの角丸 + 薄い枠線。トークンと部品は **DESIGN.md** が正。画面ごとに class 文字列をコピペせず、`src/components/ui/` の部品（Button / Card / PageHeader / Stat / Table 系 / LinkTabs / EmptyState / Alert / Field …）を使う。色は #hex 直書き禁止（トークンのみ）。

## Anti-Patterns

| 禁止                                                                              | 理由                                                 | 代替                                                                                  |
| --------------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `middleware.ts` を作る                                                            | Next 16 で廃止                                       | `src/proxy.ts`（`export function proxy`）                                             |
| `params` / `searchParams` / `cookies()` を同期で読む                              | Next 16 で Promise                                   | `await` する                                                                          |
| proxy から `auth-server` / `repositories` を import                               | Edge に Node 専用の処理と Sheets 通信が載る          | proxy は `auth.ts` だけ                                                               |
| UI や API から実体リポジトリを直接 import                                         | データ層の差し替えが壊れる                           | `getRepositories()` 経由                                                              |
| `src/` の実行時コードで `googleapis` / `web-push` を使う、`bcryptjs` を新しく使う | Workers で動かない・CPU 上限を超える                 | `lib/google/rest.ts` / `lib/webpush.ts` / PBKDF2（`bcryptjs` は旧ハッシュの照合だけ） |
| サービスアカウントで新規スプレッドシート作成                                      | SA は Drive の保存容量が無く作れない                 | ユーザー所有で作成 → SA に編集者共有（`scripts/setup-sheets.mjs`）                    |
| 採番のロジックを画面側だけ直す                                                    | CLI と二重管理。同じ番号を二重に振る                 | `repositories/scope.ts` と `scripts/keiri.mjs` を同時に直す                           |
| 帳票の作成フォームで発行元を選ばせる                                              | 別会社の帳票が作った直後に一覧から消えたように見える | 選択中の会社で固定（`documents/actions.ts`）                                          |
| 認証情報をコード・チャット・コミットに書く                                        | 漏洩                                                 | `.env.local` / `.dev.vars` / Cloudflare のシークレット                                |
| 本番で `AUTH_SECRET` の検査を外す・既定値で動かす                                 | 誰でも Cookie を偽造してログインできる               | `lib/auth.ts` の `authSecretProblem` を通す                                           |
| lucide 等のアイコン / アイコンに色付き背景                                        | 統一性・視覚ノイズ                                   | `Icon`（Material）、色とサイズのみ                                                    |
| `#hex` の直書き                                                                   | テーマ崩れ                                           | `brand-*` / `ink` / `line` などのトークン                                             |
| `docs/` を置く                                                                    | 置いた文書はどこからも読まれない                     | 従う決まりは `CLAUDE.md` か `.claude/rules/`、使う人向けの説明は `README.md`          |

## Dev コマンド

- `npm ci` … 依存の取得（これをしないと `npx tsc` が別の `tsc` パッケージを取りに行く）
- `npm run dev` … 開発。`.env.local` に Sheets の資格情報があると、そのスプレッドシートに接続する。InMemory のデモデータで動かすときは `SHEETS_SPREADSHEET_ID= GOOGLE_PRIVATE_KEY= npm run dev`（`GOOGLE_SERVICE_ACCOUNT_EMAIL` を入れているなら空にしない。zod の email 検証で落ちる）
- `npm run build` … 本番ビルド（型チェック込み）。`npx tsc --noEmit` で型だけ見る
- `npm run lint` … ESLint
- `npm run format` / `npm run format:check` … Prettier で書式をそろえる / 確かめる
- `npm test` … `src/**/*.test.ts` と `scripts/**/*.test.mjs` の全テスト
- `npm run test:accounting` … 会計・書類コピー・銀行 CSV・Jev 仕訳・Google REST・Web Push・決算・freee CSV・会社スコープのテスト
- `npm run verify:money-coach` … お金コーチ・エージェント API のテスト + ビルド。money 系を変えたら通す
- `npm run icons` / `npm run icons:check` … アイコン用フォントの再生成 / 不足の検出
- `npm run dev:vinext` / `npm run build:vinext` / `npm run start:vinext` … Workers 実行環境（workerd）でローカル確認（`.dev.vars` に秘密情報。git 管理外）
- `npm run deploy`（= `node scripts/deploy-cloudflare.mjs [--dry-run]`）… Cloudflare へデプロイ。先に `npx cf auth login`。秘密情報は環境変数と `.env.local` から `SECRET_NAMES` の分だけ集めて同梱する（値は表示しない）
- `node scripts/set-cloudflare-secrets.mjs [--dry-run] [--worker 名前]` … ログイン情報・`AUTH_SECRET`・Jev/Gemini キーを対話入力して Worker に登録（wrangler を使う。先に `npx wrangler login`）
- `node scripts/set-agent-documents-token.mjs [--worker 名前]` … 書類作成 API のトークンを作って Worker に登録（値は端末にだけ表示）
- `node scripts/setup-sheets.mjs <JSON キー> <スプレッドシートの URL か ID>` … 共有済みのスプレッドシートに届くか確かめ、`.env.local` に Sheets の設定を書く
- `node scripts/import-rakuten.mjs import <csv>` / `node scripts/import-paypay.mjs <csv>` … カード明細を取り込んで費目を仕分ける
- `npm run keiri -- clients list --json` … CLI（画面を使わずに取引先・帳票を扱う。書き込みは `--execute` を付けたときだけ）
- `node scripts/freee.mjs <コマンド>` … freee 会計 API の CLI（使い方はファイル冒頭。`FREEE_CLIENT_ID` / `FREEE_CLIENT_SECRET` は環境変数か `.env.local`。書き込みは `post-bank-rows --execute` だけ）

## エージェント用の書類作成 API

`/api/agent/v1/documents`（`Authorization: Bearer <AGENT_DOCUMENTS_TOKEN>`）。`GET` は取引先・発行元・書類の一覧（書類には `issuerId` が付く）、`POST` は書類の作成（`?dryRun=1` で確認だけ）。作成と一覧の読み取りだけで、削除・取引先の変更はできない。発行元（会社）は `issuerId` で指定し、省略すると既定の会社になる。同じ会社・種類・取引先・発行日・件名の書類は二重に作らず既存の id を返す。入力の検証は `src/lib/documents/agent-request.ts`。

- `GET` の発行元には、住所・振込先の値は返さず、入っているかだけ（`hasAddress` / `hasBankInfo`）を返す。取引先は名前と敬称だけを返す。
- `PATCH /api/agent/v1/issuers/[id]` … 発行元の `postalCode` / `address` / `building` / `phone` / `email` / `registrationNumber` / `bankInfo` だけを更新する（名称・既定・印影は不可。空文字でその項目を空にする）。帳票シートは作成時の値で作られるため、請求書を作る**前**に更新する。検証は `src/lib/documents/agent-update.ts`。
- `POST /api/agent/v1/documents/[id]/void` … 書類を「無効」にする（削除はしない。番号は欠番）。下書き・発行済み・送付済みだけ可能で、入金済みは不可。
- `dryRun=1` の結果には税込合計が出ない。エージェントが利用者に確認を取るときは、`src/domain/money.ts` の `summarize()`（税額は税率ごとに切り捨て）で税込合計を計算して見せる。
- PDF のファイル名は `buildDocumentPdfFilename`（`src/lib/documents/pdfFilename.ts`）が唯一の定義: `種別_件名_取引先_発行日(YYYYMMDD)_番号.pdf`。
- 請求データ（PDF・金額・取引先）をリポジトリにコミットしない。
