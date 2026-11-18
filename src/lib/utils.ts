import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { toIsoDate } from "@/domain/dates";

/** Tailwind クラスを安全に結合する。 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** YYYY-MM-DD → 2026年6月16日 */
export function formatJpDate(iso: string): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${y}年${Number(m)}月${Number(d)}日`;
}

/** 今日の YYYY-MM-DD（ローカル） */
export function todayIso(): string {
  return toIsoDate(new Date());
}
