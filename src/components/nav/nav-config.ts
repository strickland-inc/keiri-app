/**
 * サイドメニューの定義。freee 会計のメニュー構成（経理 / 会計 / マスタ）を参考にした。
 * 画面の追加・改名はここだけで済む。
 */
export interface NavLeaf {
  label: string;
  /** クエリ付きも可（例: /documents?type=invoice）。 */
  href: string;
  /** 管理者のみ表示。 */
  adminOnly?: boolean;
  /** true なら、配下のパス（/admin/audit など）では選択中にしない。 */
  exact?: boolean;
}

export interface NavSection {
  /** 小見出し（任意）。 */
  heading?: string;
  items: NavLeaf[];
}

export interface NavGroup {
  label: string;
  icon: string;
  /** 子を持たないグループは href へ直接遷移する。 */
  href?: string;
  /** 管理者のみ表示。 */
  adminOnly?: boolean;
  sections: NavSection[];
}

export interface NavBlock {
  /** ブロック見出し（経理 / 会計 など）。 */
  heading?: string;
  groups: NavGroup[];
}

export const HOME: NavGroup = {
  label: "ホーム",
  icon: "home",
  href: "/",
  sections: [],
};

export const NAV_BLOCKS: NavBlock[] = [
  {
    heading: "経理",
    groups: [
      {
        label: "請求・入金",
        icon: "request_quote",
        sections: [
          {
            heading: "受注・請求",
            items: [
              { label: "見積書", href: "/documents?type=quote" },
              { label: "納品書", href: "/documents?type=delivery_note" },
              { label: "請求書", href: "/documents?type=invoice" },
              { label: "領収書", href: "/documents?type=receipt" },
            ],
          },
          {
            heading: "入金管理",
            items: [
              { label: "入金待ちの請求書", href: "/documents?status=unpaid" },
              { label: "すべての書類", href: "/documents" },
            ],
          },
          {
            heading: "売上",
            items: [{ label: "売上台帳", href: "/revenues" }],
          },
        ],
      },
      {
        label: "銀行・入出金",
        icon: "account_balance",
        sections: [
          {
            items: [{ label: "銀行明細（CSV取込）", href: "/bank" }],
          },
        ],
      },
      {
        label: "発注・経費・支払",
        icon: "account_balance_wallet",
        sections: [
          {
            heading: "発注",
            items: [
              { label: "発注書", href: "/documents?type=purchase_order" },
            ],
          },
          {
            heading: "経費",
            items: [
              { label: "経費一覧", href: "/expenses" },
              { label: "レシート取込", href: "/expenses/scan" },
              { label: "カード明細の取込", href: "/expenses/import" },
            ],
          },
        ],
      },
    ],
  },
  {
    heading: "会計",
    groups: [
      {
        label: "会計帳簿",
        icon: "menu_book",
        sections: [
          {
            heading: "試算表",
            items: [
              { label: "貸借対照表", href: "/accounting/bs" },
              { label: "損益計算書", href: "/accounting/pl" },
            ],
          },
          {
            heading: "月次推移",
            items: [{ label: "月次損益計算書", href: "/accounting/monthly" }],
          },
          {
            heading: "主要簿",
            items: [
              { label: "仕訳帳", href: "/accounting/journal" },
              { label: "総勘定元帳", href: "/accounting/ledger" },
            ],
          },
        ],
      },
      {
        label: "決算",
        icon: "inventory_2",
        sections: [
          {
            items: [{ label: "決算資料・freee 取込", href: "/closing" }],
          },
        ],
      },
      {
        label: "分析・レポート",
        icon: "monitoring",
        sections: [
          {
            items: [
              { label: "支出レポート", href: "/reports" },
              { label: "お金コーチ", href: "/coach" },
            ],
          },
        ],
      },
    ],
  },
  {
    heading: "マスタ・設定",
    groups: [
      {
        label: "マスタ",
        icon: "database",
        sections: [
          {
            items: [
              { label: "取引先", href: "/parties" },
              { label: "会社", href: "/issuers" },
            ],
          },
        ],
      },
      {
        label: "その他設定",
        icon: "settings",
        // 中身がすべて管理者向けなので、メンバーには空のグループごと隠す
        adminOnly: true,
        sections: [
          {
            items: [
              { label: "ユーザー管理", href: "/admin", exact: true },
              { label: "監査ログ", href: "/admin/audit" },
              { label: "セキュリティ", href: "/admin/security" },
              { label: "API トークン", href: "/settings" },
            ],
          },
        ],
      },
    ],
  },
];

/** クエリで絞り込みを表すキー。クエリ無しのリンクはこれらが無いときだけアクティブにする。 */
const FILTER_KEYS = ["type", "status"] as const;

export function isLeafActive(
  leaf: NavLeaf,
  pathname: string,
  query: URLSearchParams,
): boolean {
  const target = new URL(leaf.href, "http://local");
  if (target.pathname === "/") return pathname === "/";
  if (leaf.exact) return pathname === target.pathname;

  const samePath =
    pathname === target.pathname || pathname.startsWith(target.pathname + "/");
  if (!samePath) return false;

  const wanted = [...target.searchParams.entries()];
  if (wanted.length > 0) {
    return (
      pathname === target.pathname &&
      wanted.every(([key, value]) => query.get(key) === value)
    );
  }
  return FILTER_KEYS.every((key) => !query.has(key));
}

export function isGroupActive(
  group: NavGroup,
  pathname: string,
  query: URLSearchParams,
): boolean {
  if (group.href) {
    return isLeafActive(
      { label: group.label, href: group.href },
      pathname,
      query,
    );
  }
  return group.sections.some((s) =>
    s.items.some((leaf) => isLeafActive(leaf, pathname, query)),
  );
}
