type Cell = string | number;

function csvCell(v: Cell): string {
  const s = String(v);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** BOM 付き UTF-8・CRLF の CSV にする。Excel で開いても文字化けしない。 */
export function toCsv(
  headers: readonly Cell[],
  rows: readonly (readonly Cell[])[],
): string {
  const lines = [headers.map(csvCell).join(",")];
  for (const r of rows) lines.push(r.map(csvCell).join(","));
  return "﻿" + lines.join("\r\n") + "\r\n";
}
