/** 日本時間の「2026/11/24 13:05」。幅の狭い表でも切れないよう、短い書式にする。サーバー側で整えて画面に渡す（ブラウザの地域設定に左右されない）。 */
export function formatDateTime(iso: string): string {
  const ms = Date.parse(iso);
  if (!iso || Number.isNaN(ms)) return "";
  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(ms));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}/${get("month")}/${get("day")} ${get("hour")}:${get("minute")}`;
}
