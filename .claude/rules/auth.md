---
description: 認証の Edge と Node の分離、セッション、管理者。認証まわりを触るときに読む
paths:
  - "src/lib/auth.ts"
  - "src/lib/auth-server.ts"
  - "src/proxy.ts"
  - "src/app/login/**"
  - "src/app/admin/**"
---

# Edge と Node を分ける

| ファイル             | 中身                                                              | 実行環境      |
| -------------------- | ----------------------------------------------------------------- | ------------- |
| `lib/auth.ts`        | セッション（HMAC 署名 Cookie、role 入り、Web Crypto）             | **Edge 互換** |
| `lib/auth-server.ts` | 資格照合（PBKDF2-SHA256、旧 bcrypt ハッシュも照合）・repositories | サーバー専用  |

<important if="proxy.ts を編集するとき">
**`proxy.ts` が import してよいのは `lib/auth.ts` だけ。**
`auth-server.ts` や `repositories` を import すると、パスワード照合と Sheets への通信が
すべてのリクエストの前に載り、Workers の CPU 上限（10ms）を超える。
</important>

## ガード

`proxy.ts` が担う。未認証は `/login` へ、一般ユーザーの `/admin` は `/` へ。

## 管理者

環境変数 `APP_LOGIN_ID` / `APP_LOGIN_PASSWORD` がブートストラップ管理者。
ユーザーが0人でもログインできる。発行ユーザーは Sheets の `users` タブに
PBKDF2 のハッシュで持ち（以前に作った bcrypt のハッシュも照合できる）、`role` は admin か user。
bcrypt は純 JS で CPU を使い、Workers の無料枠を超えるため、新しく作るハッシュは PBKDF2 にする。`/admin` で発行（パスワード自動生成・
1回だけ表示）・一覧・削除ができる。

## 公開範囲

metadata の `robots=noindex` と `app/robots.ts` で検索除外する。会計データなので
インデックスさせない。アプリ内ログインで守る。

## 資格情報

コード・チャット・コミットに書かない。`.env.local`（Workers の実行環境では `.dev.vars`）と
Cloudflare のシークレット（`cloudflare.config.ts` の `SECRET_NAMES`）で渡す。
<important if="AUTH_SECRET の扱いを変えるとき">
本番（`NODE_ENV=production`）の `AUTH_SECRET` は必須（16 文字以上）。検査は `lib/auth.ts` の
`authSecretProblem` 1 か所にあり、次の 3 つがこれを使う。どれも外さない。

- `proxy.ts` … `authSecretRejection` で、ログイン画面と API も含めた全リクエストを 500 で断る。
  Cloudflare Workers ではプロセスを止められないので、ここが本番の止め所になる
- `instrumentation-node.ts` … `next start` の起動時に理由を出して `process.exit(1)` する。
  例外を投げるだけだと、Next.js はプロセスを残して 500 を返し続ける
- `createSession` / `verifySession` … 鍵が無ければ Cookie を作らず、どの Cookie も通さない

開発中（`npm run dev`）は未設定でも固定値で動く。テストは `lib/auth.test.ts`。
</important>
