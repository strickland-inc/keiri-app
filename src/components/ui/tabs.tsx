import Link from "next/link";
import { cn } from "@/lib/utils";

export interface TabItem {
  label: string;
  href: string;
  active: boolean;
}

/** URL で切り替えるタブ（絞り込み・年度など）。選択中は白い面に浮かせる。 */
export function LinkTabs({
  items,
  label,
}: {
  items: readonly TabItem[];
  label?: string;
}) {
  return (
    <nav aria-label={label} className="max-w-full overflow-x-auto">
      <div className="inline-flex gap-0.5 rounded-full bg-canvas p-1">
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            aria-current={item.active ? "page" : undefined}
            className={cn(
              "whitespace-nowrap rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors",
              item.active
                ? "bg-surface text-ink shadow-[0_0_0_1px_var(--color-line)]"
                : "text-ink-muted hover:text-ink",
            )}
          >
            {item.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
