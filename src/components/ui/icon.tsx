import { cn } from "@/lib/utils";

interface IconProps {
  /** Material Symbols 名（例: "home", "add"）。使ったら `npm run icons` でフォントに含める。 */
  name: string;
  /** サイズは font-size、色は text-color で指定する（例: "text-[20px] text-ink-muted"）。 */
  className?: string;
  /** 塗りつぶし版にする。 */
  filled?: boolean;
}

/**
 * Material Symbols（Outlined・細め）。アプリのアイコンはすべてこれで統一する。
 * 読み込み前の英字を見せない処理は globals.css と IconFontGate にある。
 */
export function Icon({ name, className, filled }: IconProps) {
  return (
    <span
      className={cn(
        "material-symbols-outlined shrink-0 select-none",
        className,
      )}
      style={filled ? { fontVariationSettings: "'FILL' 1" } : undefined}
      aria-hidden="true"
    >
      {name}
    </span>
  );
}
