# keiri-app のデザインシステム

OpenAI のプロダクト UI を手本にした、静かでモダンな業務 UI。**モノトーン + 広い余白 + 大きめの角丸 + ごく薄い枠線**。色は意味のあるところ（状態・増減）にだけ使う。

## 原則

1. **余白で区切る** — 影や濃い罫線に頼らず、余白と 1px の薄い枠線で面を分ける。
2. **主役は 1 つ** — 画面ごとに主ボタン（黒）は 1 つ。他は secondary / ghost。
3. **数字は読みやすく** — 金額・件数は `tabular`（等幅数字）で右寄せ。
4. **装飾しない** — アイコンは線の細い Material Symbols を、色とサイズだけで使う（丸や四角の背景は付けない）。
5. **状態は文字と色の両方で** — 色だけに頼らない（バッジは文字つき）。
6. **説明文を置かない** — 見出しで分かる名前を付け、補足は文章ではなく UI（バッジ、カウンター、placeholder、状態の色）で伝える。ページの見出しの下、カードの冒頭、入力欄の下に、説明の文章を書かない。残すのはエラーと、取り返しのつかない操作の確認だけ。

## トークン

`src/app/globals.css` の `@theme` に定義する。

| 用途                                         | クラス                                                     | 値                                   |
| -------------------------------------------- | ---------------------------------------------------------- | ------------------------------------ |
| 面（ページ・カード）                         | `bg-surface`                                               | `#fff`                               |
| 薄いグレー面（サイドバー・ホバー・表見出し） | `bg-canvas`                                                | `#f7f7f8`                            |
| 罫線                                         | `border-line` / `border-line-strong`                       | `#ececec` / `#d9d9de`                |
| 本文                                         | `text-ink`                                                 | `#0d0d0d`                            |
| 補助文字                                     | `text-ink-muted` / `text-ink-faint`                        | `#676767` / `#9b9b9b`                |
| ブランドの緑                                 | `brand-50…900`（500 = `#00ac3a`）                          | 状態表示・強調・フォーカスに少量だけ |
| 状態                                         | `success` / `warning` / `danger`                           | 増減・警告・エラー                   |
| 角丸                                         | `rounded-[var(--radius)]`（12px）/ `rounded-2xl`（カード） | ボタンは `rounded-full`              |

**#hex の直書きは禁止。** 色は必ずトークンから使う。

## タイポグラフィ

システムの日本語フォント（`-apple-system, "Hiragino Sans", "Noto Sans JP"…`）。基本 14px。

- ページ見出し: `text-2xl font-semibold tracking-tight`（`PageHeader`）
- セクション見出し: `text-sm font-semibold`
- 補助: `text-sm text-ink-muted` / 表見出し: `text-xs text-ink-muted`
- 金額・数値: `tabular`

## アイコン

**Material Symbols のみ**（`<Icon name="home" className="text-[20px]" />`）。必要なアイコンだけを含む小さなフォント（`public/fonts/material-symbols.woff2`）を自前で配信する。新しいアイコン名を使ったら `npm run icons` でフォントを作り直す（`npm run icons:check` で不足を検出）。

## 部品

`src/components/ui/` にある。

| 部品                                                 | 使いどころ                                                                                                         |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `Button` / `buttonVariants()`                        | `primary`（黒）/ `secondary` / `ghost` / `danger`、`sm` `md` `icon`。リンクには `buttonVariants()` を className に |
| `Card` / `CardHeader` / `CardBody`                   | 枠付きの面                                                                                                         |
| `PageHeader`                                         | 画面の見出し（タイトル・操作ボタン。説明は置かない）                                                               |
| `Stat`                                               | 数値カード（KPI）                                                                                                  |
| `TableCard` + `Table` `THead` `Th` `TBody` `Tr` `Td` | 一覧表。横スクロール対応                                                                                           |
| `LinkTabs`                                           | URL で切り替えるタブ（絞り込み・年度など）                                                                         |
| `StatusBadge` / `Badge`                              | 状態の表示（文字つき）                                                                                             |
| `EmptyState`                                         | 一覧が空のとき（題だけ。説明は置かない）                                                                           |
| `Alert`                                              | 画面内のメッセージ（エラー・情報・成功）                                                                           |
| `Field` + `Input` / `Select` / `Textarea`            | フォーム。ラベル・エラーを `Field` で。入力の形式は `pattern` / `maxLength` と placeholder で伝える                |
| `PasswordPair`                                       | 新しいパスワードと確認。文字数のカウンターと一致の印                                                               |
| `CopyButton` / `ConfirmDialog`                       | コピー（押すと「コピー済み」）/ 取り返しのつかない操作の確認（1 文）                                               |
| `Skeleton`                                           | 読み込み中の骨組み                                                                                                 |
| `Icon`                                               | アイコン                                                                                                           |

## レイアウト

- `AppShell`: 左に 256px のサイドバー（`bg-canvas`、開閉式メニュー）、右に白いメイン。モバイルはトップバー + ドロワー。
- メインは `max-w-6xl`、余白は `px-4 md:px-10`、ブロック間は `gap-8`。
- 表は `TableCard`。横幅が足りなければ横スクロール（`overflow-x-auto`）。
- フォームは `sm:grid-cols-2`。

## やってはいけないこと

| 禁止                                                        | 代替                                   |
| ----------------------------------------------------------- | -------------------------------------- |
| 別アイコンセット（lucide 等）/ アイコンの色付き丸・角丸背景 | `Icon` と色・サイズのみ                |
| #hex の直書き                                               | トークン                               |
| 濃い罫線・ゼブラ・強い影                                    | `border-line`、行ホバー `bg-canvas/70` |
| 画面ごとに同じ class 文字列をコピペ                         | `src/components/ui/` の部品            |
| 金額を等幅・右寄せにしない                                  | `tabular` + `text-right`               |
