# 楽天カードメール自動取込 GAS

楽天カードの「カード利用のお知らせ（確定版）」メールを Gmail から1時間ごとに取込み、Google Sheets の `expenses` タブに追記する Google Apps Script。

**運用方針（重要）**: 楽天カードの取込は**このメール自動取込を正**とする。同じ取引を CSV (`scripts/import-rakuten.mjs`) でも取り込むと、メールと CSV で店名表記が違う（メール `ｻﾝﾌﾟﾙｼｮｳﾃﾝ` / CSV `ＶＩＳＡ国内利用　VS ｻﾝﾌﾟﾙｼｮｳﾃﾝ`）ため `date|merchant|amount` の重複判定をすり抜けて**二重計上**になる。**楽天カードは原則 CSV 取込しない**（バックフィル等で使う場合は期間の重複に注意）。

---

## セットアップ

1. `clasp create --type standalone --title "keiri-rakuten-mail" --rootDir .` を `scripts/gas` で実行し、自分の Google アカウントにスクリプトを作る（`.clasp.json` は自分用なので git に入れない）。
2. `rakuten-mail-import.gs` の `SPREADSHEET_ID` を、バックエンドのスプレッドシート ID に書き換える。**Script Properties の設定は不要**。
3. `clasp push -f` でコードを反映する。
4. 関数 `importRakutenMail` を実行 → OAuth 同意（Gmail 読取/ラベル・Sheets 編集）を**許可**。
   - 「このアプリは確認されていません」と出たら _詳細 → （プロジェクト名）に移動_ で進める（自分のスクリプトなので安全）。
5. 関数 `setupTrigger` を実行 → 1時間ごとの自動実行を登録。

`GEMINI_API_KEY` は**任意**。Script Property に入れればルール未確定の費目を AI 補完する。未設定なら未確定は「要確認」で入り、ローカルの `scripts/reclassify-expenses.mjs` で後から AI 精緻化できる。

> Gmail 読取の同意は本人のブラウザ操作が必須（自分の Gmail を読ませる同意は本人しかできない）。

## コードを更新したいとき

```sh
cd scripts/gas
clasp push -f        # appsscript.json と rakuten-mail-import.gs を再反映
```

---

## 取込仕様

- **対象メール**: `in:anywhere from:rakuten-card.co.jp subject:カード利用のお知らせ -label:keiri-imported newer_than:60d`
  - `in:anywhere` で**迷惑メール・ゴミ箱も対象**（楽天の利用お知らせが迷惑メールに振り分けられる事故への保険）。
- **速報版と確定版**: 本文に `■利用先:` があるものを確定版とする。利用先の無い速報版は「利用先未確定（楽天速報）」・備考「確定版待ち」で先に登録し、確定版が届いたら同じ日・同じ金額の行を置き換える。
- **本文フォーマット**: 確定版は `■利用日: YYYY/MM/DD` / `■利用先: <店名>` / `■利用金額: <金額> 円` の繰り返し。1通に複数取引があれば全部抽出。
- **重複スキップ**: 既存 `expenses` 行と `date|merchant|amount` 一致なら追記しない。
- **追記フォーマット**: `[uuid, date(YYYY-MM-DD), merchant, amount(文字列), category, "楽天メール", "", createdAt(ISO), updatedAt(ISO)]`
- **費目分類**: **自己学習辞書(`merchant_rules`シート)** → ルール辞書（`scripts/classify.mjs` の RULES を移植）→ 10万円以上で未確定は「要確認」→ Gemini（任意）→ 失敗/鍵未設定は「要確認」。学習辞書はアプリで費目を確定すると自動で増え、よく行く店は AI 不要・キー無しでも即確定する。
- **処理済みラベル**: 検索ヒットしたスレッドに `keiri-imported` を付与して再処理を防ぐ。

---

## よく使う利用先レポート

実体は `reports.gs`。

expenses シートの取引を利用先ごとに集計し、週次・月次でメールに自動送信する。

### レポート仕様

- **週次** (`sendWeeklyReport`): 先週月曜〜日曜を集計。件名「【keiri】先週のよく使う利用先レポート（M/D〜M/D）」。
- **月次** (`sendMonthlyReport`): 今月1日〜当日を集計。件名「【keiri】今月のよく使う利用先レポート（YYYY年M月）」。
- 送信先: `Session.getActiveUser().getEmail()`（取得できなければ `reports.gs` の `REPORT_FALLBACK_TO`。既定は空）。
- 内容: 期間サマリ（合計金額・件数）＋利用先ランキング上位15（利用先名・回数・合計・主な費目）。
- **利用先名の正規化** (`normalizeMerchant_`): CSV 由来の「ＶＩＳＡ国内利用　VS 」等のカードプレフィックス・末尾の「利用国XX」・末尾の店舗番号（連続数字）を除去して同一利用先をまとめる。

### 初回のセットアップ

1. 自分のスクリプトを開く（`clasp push -f` でコードを反映済みであること）。
2. `setupReportTriggers` を手動実行 → 週次・月次トリガーを登録。
3. 初回実行時に OAuth 同意画面が出るので「**メールの送信**」権限を追加で許可する（`appsscript.json` に `script.send_mail` スコープを追加済みのため再認可が必要）。

> `setupReportTriggers` は冪等。同ハンドラの既存トリガーを削除してから再作成するため、重複しない。

---

---

## プッシュ通知

`reports.gs` の `pingPushNotification_` が送る。

週次・月次レポートのメール送信後に、アプリの `/api/push/send` を叩いてブラウザへプッシュ通知を送ります。

### 仕組み

1. `sendWeeklyReport` / `sendMonthlyReport` の末尾で `pingPushNotification_('weekly', range)` / `pingPushNotification_('monthly')` を呼ぶ。
2. GAS は Script Properties の `APP_BASE_URL` と `PUSH_SECRET` を読んで `POST {APP_BASE_URL}/api/push/send` を送信（週次は確定済みの集計期間も渡す）。
3. アプリ側は `x-push-secret` ヘッダーを検証し、購読中のブラウザ全件へ Web Push を送信。
4. 失敗しても `try-catch` で握り潰し、メール送信は影響を受けません。

### 初回の Script Properties の設定

GAS スクリプトエディタ左のメニュー「プロジェクトの設定」→「スクリプト プロパティ」で以下を追加します。

| プロパティ名   | 値の例                                  |
| -------------- | --------------------------------------- |
| `APP_BASE_URL` | `https://keiri-app.example.workers.dev` |
| `PUSH_SECRET`  | アプリの環境変数 `PUSH_SECRET` と同じ値 |

**注意**: `PUSH_SECRET` の値をチャット・コード・README 本文に直書きしないこと。GAS の Script Properties は暗号化されて保管されます。

---

## 診断用の関数

どれも取込はしない。

- `diagnoseRakutenMail` … 楽天系メールが受信箱に届いているか、検索ごとのヒット数と差出人・件名を実行ログに出す。
- `dumpLatestRakutenMail` … 最新の確定版メールのプレーン本文を実行ログに出す（パーサ調整用）。
