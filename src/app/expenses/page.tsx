import Link from "next/link";
import { getRepositories } from "@/repositories";
import { companyScope, loadCompanyContext } from "@/lib/active-company";
import {
  isExpenseCategory,
  type Expense,
  type ExpenseCategory,
} from "@/domain/expense";
import {
  expensePeriodLabel,
  filterExpenses,
  hasActiveExpenseSearch,
  isExpenseSearchPeriod,
  isExpenseSearchStatus,
  type ExpenseSearchFilters,
  type ExpenseSearchPeriod,
} from "@/domain/expense-search";
import { formatYen } from "@/domain/money";
import { formatJpDate } from "@/lib/utils";
import { recentMonths, toYearMonth } from "@/domain/dates";
import { firstParam, type SearchParamValue } from "@/lib/search-params";
import { Icon } from "@/components/ui/icon";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { LinkTabs } from "@/components/ui/tabs";
import {
  Table,
  TableCard,
  TBody,
  Td,
  Th,
  THead,
  Tr,
} from "@/components/ui/table";
import { CategorySelect } from "./category-select";
import { ExpenseSearchForm } from "./expense-search-form";

export const dynamic = "force-dynamic";

interface ExpenseSearchParams {
  q?: SearchParamValue;
  period?: SearchParamValue;
  month?: SearchParamValue;
  category?: SearchParamValue;
  status?: SearchParamValue;
  source?: SearchParamValue;
  minAmount?: SearchParamValue;
  maxAmount?: SearchParamValue;
}

function readAmount(value: SearchParamValue): number | null {
  const normalized = firstParam(value)
    .normalize("NFKC")
    .replace(/[,¥￥円\s]/g, "");
  if (!/^\d+$/.test(normalized)) return null;

  const amount = Number(normalized);
  return Number.isSafeInteger(amount) ? amount : null;
}

function readFilters(
  sp: ExpenseSearchParams,
  currentMonth: string,
): ExpenseSearchFilters {
  const requestedPeriod = firstParam(sp.period);
  // 旧 URL の ?month=YYYY-MM も period=month:YYYY-MM として受ける
  const legacyMonth = firstParam(sp.month);
  const legacyPeriod = /^\d{4}-(0[1-9]|1[0-2])$/.test(legacyMonth)
    ? `month:${legacyMonth}`
    : "";
  const periodCandidate = requestedPeriod || legacyPeriod;
  const defaultPeriod: ExpenseSearchPeriod = `month:${currentMonth}`;
  const period = isExpenseSearchPeriod(periodCandidate)
    ? periodCandidate
    : defaultPeriod;

  const categoryCandidate = firstParam(sp.category);
  const statusCandidate = firstParam(sp.status);

  return {
    query: firstParam(sp.q).trim().slice(0, 100),
    period,
    category: isExpenseCategory(categoryCandidate) ? categoryCandidate : "",
    status: isExpenseSearchStatus(statusCandidate) ? statusCandidate : "all",
    source: firstParam(sp.source).trim().slice(0, 120),
    minAmount: readAmount(sp.minAmount),
    maxAmount: readAmount(sp.maxAmount),
  };
}

export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<ExpenseSearchParams>;
}) {
  const sp = await searchParams;
  // 月の選択肢は新しい順に並べる
  const months = recentMonths(24).reverse();
  const defaultMonth = toYearMonth(new Date());
  const filters = readFilters(sp, defaultMonth);
  const isSearchActive = hasActiveExpenseSearch(filters, defaultMonth);

  const repos = await getRepositories();
  const company = await loadCompanyContext(repos);
  const allExpenses = await repos.expenses.list(companyScope(company));
  const expenses = filterExpenses(allExpenses, filters);
  const sources = [
    ...new Set(allExpenses.map((expense) => expense.source).filter(Boolean)),
  ].sort((a, b) => a.localeCompare(b, "ja"));

  const totalAmount = expenses.reduce((sum, e) => sum + e.amount, 0);

  const categoryTotalsMap = new Map<ExpenseCategory, number>();
  for (const exp of expenses) {
    categoryTotalsMap.set(
      exp.category,
      (categoryTotalsMap.get(exp.category) ?? 0) + exp.amount,
    );
  }
  const categorySummary = [...categoryTotalsMap.entries()].sort(
    (a, b) => b[1] - a[1],
  );

  const periodLabel = expensePeriodLabel(filters.period);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="経費"
        actions={
          <Link
            href="/expenses/scan"
            className={buttonVariants({ variant: "secondary" })}
          >
            <Icon name="document_scanner" className="text-[18px]" />
            レシートをスキャン
          </Link>
        }
      />

      <div className="flex flex-col gap-4">
        <LinkTabs label="期間" items={periodTabs(filters, defaultMonth)} />
        <ExpenseSearchForm
          filters={filters}
          months={months}
          sources={sources}
          isActive={isSearchActive}
        />
      </div>

      <ExpenseSummary
        title={`${periodLabel}${isSearchActive ? "の検索結果" : "の合計"}`}
        count={expenses.length}
        totalAmount={totalAmount}
        categorySummary={categorySummary}
      />

      {expenses.length === 0 ? (
        <EmptyState
          icon={isSearchActive ? "search_off" : "receipt_long"}
          title={
            isSearchActive
              ? "条件に一致する経費がありません"
              : `${periodLabel}の経費がありません`
          }
          description={
            isSearchActive
              ? "キーワードや絞り込み条件を変えて、もう一度お試しください。"
              : "楽天カード明細の取り込みスクリプトで追加できます。"
          }
          action={
            isSearchActive && (
              <Link
                href="/expenses"
                className={buttonVariants({ variant: "secondary", size: "sm" })}
              >
                条件をクリア
              </Link>
            )
          }
        />
      ) : (
        <ExpenseTable expenses={expenses} />
      )}
    </div>
  );
}

/** 期間の素早い切替。検索条件はそのまま引き継ぐ。 */
function periodTabs(filters: ExpenseSearchFilters, currentMonth: string) {
  const options: { label: string; period: ExpenseSearchPeriod }[] = [
    { label: "今月", period: `month:${currentMonth}` },
    { label: "過去3か月", period: "last3" },
    { label: "今年", period: "year" },
    { label: "全期間", period: "all" },
  ];
  return options.map(({ label, period }) => {
    const params = new URLSearchParams();
    if (filters.query) params.set("q", filters.query);
    params.set("period", period);
    if (filters.category) params.set("category", filters.category);
    if (filters.status !== "all") params.set("status", filters.status);
    if (filters.source) params.set("source", filters.source);
    if (filters.minAmount !== null)
      params.set("minAmount", String(filters.minAmount));
    if (filters.maxAmount !== null)
      params.set("maxAmount", String(filters.maxAmount));
    return {
      label,
      href: `/expenses?${params}`,
      active: filters.period === period,
    };
  });
}

function ExpenseSummary({
  title,
  count,
  totalAmount,
  categorySummary,
}: {
  title: string;
  count: number;
  totalAmount: number;
  categorySummary: [ExpenseCategory, number][];
}) {
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[13px] text-ink-muted">{title}</p>
        <p className="text-xs tabular text-ink-muted">{count}件</p>
      </div>
      <p className="mt-1 text-2xl font-semibold tabular tracking-tight text-ink">
        {formatYen(totalAmount)}
      </p>

      {categorySummary.length > 0 && (
        <div className="mt-5 grid grid-cols-2 gap-x-8 gap-y-2 border-t border-line pt-4 sm:grid-cols-3 lg:grid-cols-4">
          {categorySummary.map(([category, amount]) => (
            <div
              key={category}
              className="flex items-center justify-between gap-2 text-sm"
            >
              <span className="truncate text-ink-muted">{category}</span>
              <span className="shrink-0 tabular font-medium text-ink">
                {formatYen(amount)}
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function ExpenseTable({ expenses }: { expenses: Expense[] }) {
  return (
    <TableCard>
      <Table>
        <THead>
          <Th>日付</Th>
          <Th>店名</Th>
          <Th align="right">金額</Th>
          <Th>費目</Th>
          <Th>ソース</Th>
        </THead>
        <TBody>
          {expenses.map((expense) => (
            <Tr key={expense.id}>
              <Td nowrap muted numeric>
                {formatJpDate(expense.date)}
              </Td>
              <Td className="max-w-xs truncate">{expense.merchant}</Td>
              <Td align="right" numeric nowrap className="font-medium">
                {formatYen(expense.amount)}
              </Td>
              <Td className="min-w-40">
                <CategorySelect
                  id={expense.id}
                  currentCategory={expense.category}
                />
              </Td>
              <Td muted className="text-xs">
                {expense.source}
              </Td>
            </Tr>
          ))}
        </TBody>
      </Table>
    </TableCard>
  );
}
