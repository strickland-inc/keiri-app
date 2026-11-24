import type { ReactNode } from "react";
import Link from "next/link";
import { EXPENSE_CATEGORIES } from "@/domain/expense";
import type { ExpenseSearchFilters } from "@/domain/expense-search";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

interface ExpenseSearchFormProps {
  filters: ExpenseSearchFilters;
  months: readonly string[];
  sources: readonly string[];
  isActive: boolean;
}

function monthLabel(month: string): string {
  const [year, monthNumber] = month.split("-");
  return `${year}年${Number(monthNumber)}月`;
}

/** 金額欄。左に ¥ を重ねる。 */
function YenInput({ children }: { children: ReactNode }) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-ink-muted">
        ¥
      </span>
      {children}
    </div>
  );
}

export function ExpenseSearchForm({
  filters,
  months,
  sources,
  isActive,
}: ExpenseSearchFormProps) {
  return (
    <Card>
      <form action="/expenses" method="get" className="p-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field
            label="キーワード"
            htmlFor="expense-query"
            className="sm:col-span-2"
          >
            <div className="relative">
              <Icon
                name="search"
                className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[18px] text-ink-faint"
              />
              <Input
                id="expense-query"
                name="q"
                type="search"
                defaultValue={filters.query}
                placeholder="店名・金額・費目・メモを検索"
                autoComplete="off"
                className="pl-10"
              />
            </div>
          </Field>

          <Field label="期間" htmlFor="expense-period">
            <Select
              id="expense-period"
              name="period"
              defaultValue={filters.period}
            >
              <option value="last3">過去3か月</option>
              <option value="year">今年</option>
              <option value="all">全期間</option>
              <optgroup label="月を指定">
                {months.map((month) => (
                  <option key={month} value={`month:${month}`}>
                    {monthLabel(month)}
                  </option>
                ))}
              </optgroup>
            </Select>
          </Field>

          <Field label="費目" htmlFor="expense-category">
            <Select
              id="expense-category"
              name="category"
              defaultValue={filters.category}
            >
              <option value="">すべての費目</option>
              {EXPENSE_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="状態" htmlFor="expense-status">
            <Select
              id="expense-status"
              name="status"
              defaultValue={filters.status}
            >
              <option value="all">すべての状態</option>
              <option value="review">要確認</option>
              <option value="pending">確定待ち</option>
            </Select>
          </Field>

          <Field label="ソース" htmlFor="expense-source">
            <Select
              id="expense-source"
              name="source"
              defaultValue={filters.source}
            >
              <option value="">すべてのソース</option>
              {sources.map((source) => (
                <option key={source} value={source}>
                  {source}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="金額（下限）" htmlFor="expense-min-amount">
            <YenInput>
              <Input
                id="expense-min-amount"
                name="minAmount"
                type="number"
                inputMode="numeric"
                min="0"
                step="1"
                defaultValue={filters.minAmount ?? undefined}
                placeholder="0"
                className="pl-8 tabular"
              />
            </YenInput>
          </Field>

          <Field label="金額（上限）" htmlFor="expense-max-amount">
            <YenInput>
              <Input
                id="expense-max-amount"
                name="maxAmount"
                type="number"
                inputMode="numeric"
                min="0"
                step="1"
                defaultValue={filters.maxAmount ?? undefined}
                placeholder="上限なし"
                className="pl-8 tabular"
              />
            </YenInput>
          </Field>
        </div>

        <div className="mt-5 flex flex-col gap-3 border-t border-line pt-4 sm:flex-row sm:items-center sm:justify-end">
          <div className="flex shrink-0 items-center justify-end gap-2">
            {isActive && (
              <Link
                href="/expenses"
                className={buttonVariants({ variant: "ghost" })}
              >
                条件をクリア
              </Link>
            )}
            <Button type="submit">
              <Icon name="search" className="text-[18px]" />
              検索
            </Button>
          </div>
        </div>
      </form>
    </Card>
  );
}
