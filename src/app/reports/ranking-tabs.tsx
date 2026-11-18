"use client";

import { useState } from "react";
import type { ReactElement } from "react";
import type { MerchantRankItem } from "@/domain/reports";
import { formatYen } from "@/domain/money";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { cn } from "@/lib/utils";

interface RankingTabsProps {
  byCount: MerchantRankItem[];
  byAmount: MerchantRankItem[];
}

type TabKey = "count" | "amount";

const TABS: { key: TabKey; label: string }[] = [
  { key: "count", label: "回数順" },
  { key: "amount", label: "金額順" },
];

export function RankingTabs({
  byCount,
  byAmount,
}: RankingTabsProps): ReactElement {
  const [tab, setTab] = useState<TabKey>("count");
  const items = tab === "count" ? byCount : byAmount;

  return (
    <div>
      {/* LinkTabs と同じ見た目。ここは URL を変えないので button にしている */}
      <div className="px-5 pt-4">
        <div
          role="tablist"
          className="inline-flex gap-0.5 rounded-full bg-canvas p-1"
        >
          {TABS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={cn(
                "whitespace-nowrap rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors",
                tab === key
                  ? "bg-surface text-ink shadow-[0_0_0_1px_var(--color-line)]"
                  : "text-ink-muted hover:text-ink",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {items.length === 0 ? (
        <div className="p-5">
          <EmptyState
            icon="leaderboard"
            title="この期間の経費データがありません"
          />
        </div>
      ) : (
        <div className="mt-4 overflow-x-auto border-t border-line">
          <Table>
            <THead>
              <Th className="w-8">#</Th>
              <Th>利用先</Th>
              <Th align="right">回数</Th>
              <Th align="right">合計金額</Th>
              <Th>主な費目</Th>
            </THead>
            <TBody>
              {items.map((item, i) => (
                <Tr key={item.merchant}>
                  <Td numeric muted>
                    {i + 1}
                  </Td>
                  <Td className="max-w-[14rem] truncate font-medium">
                    {item.merchant}
                  </Td>
                  <Td align="right" numeric>
                    {item.count}回
                  </Td>
                  <Td align="right" numeric className="font-medium">
                    {formatYen(item.total)}
                  </Td>
                  <Td muted>{item.topCategory}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </div>
      )}
    </div>
  );
}
