---
description: レイヤリングと依存の向き、金額、画面と API の一覧。src/ を触るときに読む
paths:
  - "src/**"
---

# レイヤリング

依存の向きは常に内側へ。外側（app）から内側（domain）へは依存してよいが、逆は不可。

```
src/
  domain/          フレームワーク非依存。型とビジネスルールだけ（node --test で直接テストする）
    documents.ts   帳票（請求/見積/納品/発注/領収）とコピーの下書き
    party.ts       取引先
    issuer.ts      発行元 = 会社（company-scope.md）
    money.ts       税率別の小計・消費税・合計（インボイス方式）
    dates.ts       日付の整形（YYYY-MM-DD / YYYY-MM）と直近の月の一覧
    numbering.ts   採番フォーマット（0001）
    accounting.ts  自動仕訳と会計帳簿（BS/PL/月次/仕訳帳/元帳）
    bank.ts        銀行明細 CSV の判定と読み取り
    fiscal-year.ts 会社の事業年度（第n期の期間）
    closing.ts     期ごとの決算集計
    revenue.ts     売上台帳
  repositories/    永続化の抽象と実体（repositories-and-sheets.md）
  lib/             横断の実装（auth.md / pdf-and-documents.md / agent-api.md）
    google/rest.ts Google API の軽量クライアント（fetch + Web Crypto。Workers で動く）
    webpush.ts     Web Push（RFC 8291。Workers で動く）
    active-company.ts  選択中の会社（company-scope.md）
    closing/       決算の読み込みと CSV
  app/             画面・API route・Server Actions
  components/      UI（ui/ にプリミティブ、nav/ にメニュー定義）
  proxy.ts         認証ガード。Next 16 で middleware.ts の後継
```

**UI と API は `repositories/types.ts` のインターフェースにだけ依存する。**
実体（InMemory / Sheets）を直接 import しない。これが「後で DB へ差し替える」の境界。

## 実行環境

本番は Cloudflare Workers（無料プラン）。`src/` の実行時コードは Workers で動くものだけを使い、
Node 専用のライブラリ（`googleapis` / `web-push` など）を import しない。`bcryptjs` は、旧ハッシュの照合で
`lib/auth-server.ts` が遅延読み込みしているだけで、新しく使わない（`auth.md`）。
CPU と外部通信の上限、課金対象を使わない決まりは `CLAUDE.md` の「Cloudflare Workers」にある。
`scripts/` のローカル専用 CLI は devDependency の `googleapis` を使ってよい。

## 金額

`domain/money.ts` の `summarize()` が税率別に集計する。**金額は円・整数で扱う。**
浮動小数を持ち込まない。表示の桁揃えは `className="tabular"`。

## 画面と入口

| 種別 | パス                                                                                                                                                                                                                                      |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 画面 | `/`, `/documents`（+`/new` `/[id]` `/[id]/edit`）, `/revenues`, `/expenses`（+`/scan`）, `/bank`, `/accounting/{bs,pl,monthly,journal,ledger}`, `/closing`, `/reports`, `/coach`, `/parties`, `/issuers`, `/settings`, `/login`, `/admin` |
| API  | `/api/documents/[id]/pdf`, `/api/ai/{estimate,finance-advice}`, `/api/bank/{parse,classify}`, `/api/closing/{freee-csv,trial-balance}`, `/api/expenses/scan`, `/api/agent/v1/{documents,issuers,money}/*`, `/api/push/*`                  |

画面を足したら、メニュー（`components/nav/nav-config.ts`）にも足す。

## ファイルを分割する基準

行数ではなく責務で切る。独立した変更理由がある、server と client が混ざる、
単独で意味のあるテストが書ける、のいずれかを満たしたら分ける。
責務境界を作らず移動コストだけ増やす極小ファイルは作らない。

## テストから読み込む domain の import

`node --test` は TypeScript の型だけを外して実行するので、**値を import する相対パスには `.ts` を付ける**
（`import { summarize } from "./money.ts"`）。`import type` は消えるので付けなくてよい。
付け忘れると `ERR_MODULE_NOT_FOUND` でテストが落ちる（2026-11 に `expense-search` で起きた）。
