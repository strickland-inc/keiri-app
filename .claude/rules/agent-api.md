---
description: エージェント API（お金の API と書類作成 API）の安全境界。money 系サービスと agent route を触るときに読む
paths:
  - "src/app/api/agent/**"
  - "src/lib/documents/agent-request.ts"
  - "src/lib/documents/agent-update.ts"
  - "src/lib/money-snapshot-service.ts"
  - "src/lib/money-write-service.ts"
  - "src/lib/agent-read-auth.ts"
  - "src/domain/money-coach.ts"
---

# 安全境界

Web の画面・お金コーチ・外部の AI エージェントが**同じ集計結果**を参照するための API。
生の明細を外へ出さないことが設計の中心にある。

- **読取と書込は別のトークンで認可する**（`AGENT_READ_TOKEN` / `AGENT_WRITE_TOKEN`）。
  読取トークンで書込 API は通らず、書込トークンで読取 API は通らない。トークンを増やす経路を足さない
- **トークン未設定は fail-closed。** 未設定時に通してはいけない
- エージェントへ返すのは集計済みの `MoneySnapshot` だけ。**生の支出明細を返さない**
- 書き込み（`/api/agent/v1/money/write`）は、呼び出す側のエージェントが利用者の承認を取ってから送る前提。
  サーバー側は承認の有無を知らないので、トークン・項目の allowlist・楽観ロック・冪等キーで守る
- 実行記録の `actor` は `"agent-api"`（`lib/money-write-service.ts`）

<important if="解約状態を扱うとき">
`cancelled` への変更はプロバイダー側の解約根拠が必須。
`cancellation_requested` は**予測から除外しない**。申請しただけでは引落は止まらないため。
</important>

# 会社スコープの扱い

お金の API（`/api/agent/v1/money/*`）は**会社をまたぐ**（本人のお金を見る面のため）。会社別に絞らない。
理由は `company-scope.md` を参照。

書類作成 API（`/api/agent/v1/documents`）は会社の帳簿に書く。発行元（会社）は `issuerId` で指定し、
省略すると既定の会社になる。二重作成の判定は**同じ会社**の同じ種類・取引先・発行日・件名で行い、
別の会社の書類は重複として扱わない。`GET` の書類には `issuerId` を付けて返す。
トークン（`AGENT_DOCUMENTS_TOKEN`）、返してよい値、運用の順序は `CLAUDE.md` の「エージェント用の書類作成 API」にある。

# 変更したら

`npm run verify:money-coach` を通す。ここが壊れるとエージェント側が静かに誤った金額を
返すため、**例外を出さずに間違った結果を返す形の変更を入れない**。
