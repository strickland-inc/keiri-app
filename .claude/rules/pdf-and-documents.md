---
description: PDF 生成と帳票テンプレート。帳票の出力まわりを触るときに読む
paths:
  - "src/lib/pdf/**"
  - "src/lib/sheets/documentTemplate.ts"
  - "src/lib/documents/**"
  - "src/app/api/documents/**"
  - "src/app/documents/**"
---

# PDF

<important if="PDF の描画を変えるとき">
**`@react-pdf/renderer` はブラウザで実行する。サーバーで描画しない。**
サーバー（Cloudflare Workers の無料枠は CPU 10ms/リクエスト）で描くと上限を超える。
描画は `lib/pdf/browser.ts`、ボタンは `documents/[id]/pdf-download-button.tsx`。
重いライブラリはボタンを押したときに初めて読み込む。
</important>

日本語フォントは `public/fonts/NotoSansJP-*.woff` を同じサイトから読んで `Font.register` する。
CDN から取らない（オフラインとビルド再現性のため）。

帳票シートがある書類だけ、`/api/documents/[id]/pdf` が Google 側で PDF に書き出して返す
（`exportGeneratedSheetPdf`。サーバーは中継するだけで CPU を使わない）。
帳票シートの無い書類（テンプレート未設定、InMemory）は、ブラウザで描く PDF だけになる。
2 つはデザインが違う。帳票シートを使う運用では、帳票シートの PDF を正とする。

出力ファイル名は `種別_件名_取引先_発行日(YYYYMMDD)_番号.pdf`。
`lib/documents/pdfFilename.ts` の `buildDocumentPdfFilename` が唯一の定義で、手で名前を付けない。
提出に耐える名前にすることが目的なので、この形を崩さない。

# 帳票シート

Sheets バックエンドで、かつ `DOCUMENT_TEMPLATE_SPREADSHEET_ID` が設定されているときだけ作る。
テンプレートのシートを、バックエンドのスプレッドシートに `種別_番号_取引先` のタブとしてコピーし、
請求先・明細・備考・番号を差し込む（`lib/sheets/documentTemplate.ts`）。
画面の作成フォームとエージェント用 API は、同じ `lib/documents/create.ts` の
`createDocumentWithTemplate` で採番とシート作成を行う。CLI（`scripts/keiri.mjs`）も同じ条件でシートを作る。

帳票シートは**作成時の発行元の値で作られ、あとから発行元を変えても書き換わらない**。

テンプレート関連の環境変数は `DOCUMENT_TEMPLATE_SPREADSHEET_ID`（未設定ならシートを作らない）/
`DOCUMENT_TEMPLATE_SHEET_ID`（コピー元のシート。未設定なら書類の種別名のシート）/
`DOCUMENT_OUTPUT_FOLDER_ID`（任意。設定されていれば、届くかどうかを作成前に確かめるだけ）。

備考欄の結合は、値を書き込む**前**に、テンプレートにある範囲どおりに解除する（`unmergeNotesArea`）。
範囲の一部だけを解除しようとすると API が拒否し、書いたあとで解除すると結合の中の値が消える。
同じ処理が `scripts/keiri.mjs` にもある。

# 発行元の会社

帳票の発行元は作成フォームで選ばせない。作成時は選択中の会社、編集時は既に属している会社で固定する
（`documents/actions.ts`。理由は `company-scope.md`）。
