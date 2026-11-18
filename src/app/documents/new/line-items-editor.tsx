"use client";

import {
  formatYen,
  lineAmount,
  parseTaxRate,
  summarize,
  TAX_RATE_LABELS,
  type TaxRate,
} from "@/domain/money";
import type { DocumentRecord } from "@/domain/documents";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

/** 入力中の明細 1 行。数値も入力途中の文字列で持つ。 */
export interface LineItemDraft {
  name: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  taxRate: TaxRate;
}

export function emptyLineItem(): LineItemDraft {
  return { name: "", quantity: "1", unit: "", unitPrice: "0", taxRate: 0.1 };
}

export function toLineItemDraft(
  item: DocumentRecord["items"][number],
): LineItemDraft {
  return {
    name: item.name,
    quantity: String(item.quantity),
    unit: item.unit ?? "",
    unitPrice: String(item.unitPrice),
    taxRate: item.taxRate,
  };
}

export function draftToLineItem(d: LineItemDraft) {
  return {
    name: d.name,
    quantity: Number(d.quantity) || 0,
    unit: d.unit.trim() || undefined,
    unitPrice: Number(d.unitPrice) || 0,
    taxRate: d.taxRate,
  };
}

interface LineItemsEditorProps {
  items: LineItemDraft[];
  onUpdate: (index: number, patch: Partial<LineItemDraft>) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
}

/** 明細の入力表と、その下の税率別合計。 */
export function LineItemsEditor({
  items,
  onUpdate,
  onAdd,
  onRemove,
}: LineItemsEditorProps) {
  const summary = summarize(items.map(draftToLineItem));
  const headClass = "px-2 py-3 font-medium first:pl-5 last:pr-5";
  const cellClass = "px-2 py-2.5 align-middle first:pl-5 last:pr-5";

  return (
    <Card>
      <CardHeader>
        <CardTitle title="明細" />
      </CardHeader>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] text-sm">
          <thead>
            <tr className="border-b border-line bg-canvas/60 text-left text-xs text-ink-muted">
              <th className={`${headClass} min-w-[220px]`}>品名・内容</th>
              <th className={`${headClass} w-24`}>数量</th>
              <th className={`${headClass} w-20`}>単位</th>
              <th className={`${headClass} w-36`}>単価</th>
              <th className={`${headClass} w-32`}>税率</th>
              <th className={`${headClass} w-28 text-right`}>金額</th>
              <th className={`${headClass} w-12`} />
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {items.map((item, index) => {
              const row = index + 1;
              const amount = lineAmount({
                quantity: Number(item.quantity) || 0,
                unitPrice: Number(item.unitPrice) || 0,
                taxRate: item.taxRate,
              });
              return (
                <tr key={index}>
                  <td className={cellClass}>
                    <Input
                      value={item.name}
                      onChange={(e) =>
                        onUpdate(index, { name: e.target.value })
                      }
                      placeholder="品名"
                      aria-label={`${row}行目 品名`}
                    />
                  </td>
                  <td className={cellClass}>
                    <Input
                      type="number"
                      value={item.quantity}
                      onChange={(e) =>
                        onUpdate(index, { quantity: e.target.value })
                      }
                      min={0}
                      step="any"
                      className="tabular"
                      aria-label={`${row}行目 数量`}
                    />
                  </td>
                  <td className={cellClass}>
                    <Input
                      value={item.unit}
                      onChange={(e) =>
                        onUpdate(index, { unit: e.target.value })
                      }
                      placeholder="式"
                      aria-label={`${row}行目 単位`}
                    />
                  </td>
                  <td className={cellClass}>
                    <Input
                      type="number"
                      value={item.unitPrice}
                      onChange={(e) =>
                        onUpdate(index, { unitPrice: e.target.value })
                      }
                      min={0}
                      step="1"
                      className="tabular"
                      aria-label={`${row}行目 単価`}
                    />
                  </td>
                  <td className={cellClass}>
                    <Select
                      value={String(item.taxRate)}
                      onChange={(e) =>
                        onUpdate(index, {
                          taxRate: parseTaxRate(e.target.value),
                        })
                      }
                      aria-label={`${row}行目 税率`}
                    >
                      {Object.entries(TAX_RATE_LABELS).map(([rate, label]) => (
                        <option key={rate} value={rate}>
                          {label}
                        </option>
                      ))}
                    </Select>
                  </td>
                  <td
                    className={`${cellClass} whitespace-nowrap text-right tabular text-ink`}
                  >
                    {formatYen(amount)}
                  </td>
                  <td className={cellClass}>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => onRemove(index)}
                      disabled={items.length <= 1}
                      aria-label={`${row}行目を削除`}
                    >
                      <Icon name="delete" className="text-[18px]" />
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col gap-6 border-t border-line px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
        <Button type="button" variant="secondary" size="sm" onClick={onAdd}>
          <Icon name="add" className="text-[16px]" />
          行を追加
        </Button>

        <dl className="flex w-full flex-col gap-1.5 text-sm sm:w-64">
          <SummaryRow label="小計" value={formatYen(summary.subtotal)} />
          {summary.taxLines.map((line) => (
            <SummaryRow
              key={line.rate}
              label={`消費税（${TAX_RATE_LABELS[String(line.rate)]}）`}
              value={formatYen(line.taxAmount)}
            />
          ))}
          <div className="mt-1 flex items-baseline justify-between gap-6 border-t border-line pt-2.5 font-semibold text-ink">
            <dt>合計（税込）</dt>
            <dd className="text-lg tabular">{formatYen(summary.total)}</dd>
          </div>
        </dl>
      </div>
    </Card>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-6 text-ink-muted">
      <dt>{label}</dt>
      <dd className="tabular">{value}</dd>
    </div>
  );
}
