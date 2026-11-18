"use client";

import { useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";
import {
  HOME,
  NAV_BLOCKS,
  isGroupActive,
  isLeafActive,
  type NavGroup,
} from "./nav-config";

interface NavTreeProps {
  pathname: string;
  query: URLSearchParams;
  isAdmin: boolean;
  /** リンク遷移時（モバイルのドロワーを閉じるため）。 */
  onNavigate?: () => void;
}

const ROW =
  "flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition-colors";
const ROW_ACTIVE = "bg-ink/[0.07] font-medium text-ink";
const ROW_IDLE = "text-ink-muted hover:bg-ink/[0.04] hover:text-ink";

/** メニュー全体。グループは開閉式で、いま開いているページのグループは自動で開く。 */
export function NavTree({
  pathname,
  query,
  isAdmin,
  onNavigate,
}: NavTreeProps) {
  // 利用者が明示的に開閉したグループ。未操作のグループは「アクティブなら開く」。
  const [manual, setManual] = useState<Record<string, boolean>>({});

  function renderLink(group: NavGroup & { href: string }) {
    const active = isGroupActive(group, pathname, query);
    return (
      <Link
        key={group.label}
        href={group.href}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        className={cn(ROW, active ? ROW_ACTIVE : ROW_IDLE)}
      >
        <Icon name={group.icon} className="text-[20px]" />
        {group.label}
      </Link>
    );
  }

  function renderGroup(group: NavGroup) {
    if (group.href) return renderLink({ ...group, href: group.href });

    const active = isGroupActive(group, pathname, query);
    const open = manual[group.label] ?? active;
    const panelId = `nav-${group.label}`;

    return (
      <div key={group.label}>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setManual((m) => ({ ...m, [group.label]: !open }))}
          className={cn(ROW, active ? "font-medium text-ink" : ROW_IDLE)}
        >
          <Icon name={group.icon} className="text-[20px]" />
          <span className="flex-1">{group.label}</span>
          <Icon
            name="expand_more"
            className={cn(
              "text-[18px] text-ink-faint transition-transform",
              open && "rotate-180",
            )}
          />
        </button>

        {open && (
          <div
            id={panelId}
            className="mb-1 ml-[21px] border-l border-line-strong pl-2"
          >
            {group.sections.map((section, i) => (
              <div key={section.heading ?? i} className="py-1">
                {section.heading && (
                  <p className="px-3 pb-0.5 pt-1.5 text-xs text-ink-faint">
                    {section.heading}
                  </p>
                )}
                {section.items
                  .filter((leaf) => isAdmin || !leaf.adminOnly)
                  .map((leaf) => {
                    const leafActive = isLeafActive(leaf, pathname, query);
                    return (
                      <Link
                        key={leaf.href}
                        href={leaf.href}
                        onClick={onNavigate}
                        aria-current={leafActive ? "page" : undefined}
                        className={cn(
                          "block rounded-lg px-3 py-1.5 text-[13px] transition-colors",
                          leafActive ? ROW_ACTIVE : ROW_IDLE,
                        )}
                      >
                        {leaf.label}
                      </Link>
                    );
                  })}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <nav aria-label="メインメニュー" className="flex flex-col gap-1">
      {renderGroup(HOME)}
      {NAV_BLOCKS.map((block, i) => {
        const groups = block.groups.filter((g) => isAdmin || !g.adminOnly);
        if (groups.length === 0) return null;
        return (
          <div key={block.heading ?? i} className="mt-4 flex flex-col gap-0.5">
            {block.heading && (
              <p className="px-3 pb-1 text-xs font-medium text-ink-faint">
                {block.heading}
              </p>
            )}
            {groups.map(renderGroup)}
          </div>
        );
      })}
    </nav>
  );
}
