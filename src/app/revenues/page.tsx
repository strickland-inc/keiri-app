import Link from "next/link";
import { getRepositories } from "@/repositories";
import { companyScope, loadCompanyContext } from "@/lib/active-company";
import { formatYen } from "@/domain/money";
import { formatJpDate } from "@/lib/utils";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, SectionCard } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Stat } from "@/components/ui/stat";
import {
  Table,
  TableCard,
  TBody,
  Td,
  Th,
  THead,
  Tr,
} from "@/components/ui/table";
import { firstParam, type SearchParamValue } from "@/lib/search-params";
import { RevenueForm } from "./revenue-form";
import { DeleteRevenueButton } from "./delete-button";
import { createRevenue } from "./actions";

export const dynamic = "force-dynamic";

interface RevenueSearchParams {
  month?: SearchParamValue;
  from?: SearchParamValue;
  to?: SearchParamValue;
}

function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number);
  const from = `${month}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const to = `${month}-${String(lastDay).padStart(2, "0")}`;
  return { from, to };
}

export default async function RevenuesPage({
  searchParams,
}: {
  searchParams: Promise<RevenueSearchParams>;
}) {
  const sp = await searchParams;
  const month = firstParam(sp.month);
  const isMonthFilter = /^\d{4}-(0[1-9]|1[0-2])$/.test(month);
  const rawFrom = firstParam(sp.from);
  const rawTo = firstParam(sp.to);
  const isDate = (v: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(v);

  // 月の指定があれば、from / to より優先する
  let from: string | undefined;
  let to: string | undefined;
  if (isMonthFilter) {
    const range = monthRange(month);
    from = range.from;
    to = range.to;
  } else {
    from = isDate(rawFrom) ? rawFrom : undefined;
    to = isDate(rawTo) ? rawTo : undefined;
  }
  const isFiltered = Boolean(from || to);

  const repos = await getRepositories();
  const company = await loadCompanyContext(repos);
  const revenues = await repos.revenues.list({
    ...companyScope(company),
    from,
    to,
  });
  const parties = await repos.parties.list();

  const totalAmount = revenues.reduce((sum, r) => sum + r.amount, 0);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="売上"
        description="帳票の無い入金（通帳から拾った売上など）を会社ごとに記録します。"
      />

      <SectionCard title="売上を追加">
        <RevenueForm parties={parties} action={createRevenue} />
      </SectionCard>

      <Card>
        <form
          action="/revenues"
          method="get"
          className="flex flex-wrap items-end gap-4 p-5"
        >
          <Field label="月で絞り込み" htmlFor="revenue-month">
            <Input
              id="revenue-month"
              name="month"
              type="month"
              defaultValue={isMonthFilter ? month : ""}
            />
          </Field>
          <Field label="期間（から）" htmlFor="revenue-from">
            <Input
              id="revenue-from"
              name="from"
              type="date"
              defaultValue={!isMonthFilter && from ? from : ""}
            />
          </Field>
          <Field label="期間（まで）" htmlFor="revenue-to">
            <Input
              id="revenue-to"
              name="to"
              type="date"
              defaultValue={!isMonthFilter && to ? to : ""}
            />
          </Field>
          <Button type="submit" variant="secondary">
            絞り込む
          </Button>
          {isFiltered && (
            <Link
              href="/revenues"
              className={buttonVariants({ variant: "ghost" })}
            >
              条件をクリア
            </Link>
          )}
        </form>
      </Card>

      <Stat
        label={isFiltered ? "絞り込み結果の合計" : "全期間の合計"}
        value={formatYen(totalAmount)}
        hint={`${revenues.length}件`}
      />

      {revenues.length === 0 ? (
        <EmptyState
          icon="payments"
          title={
            isFiltered
              ? "条件に一致する売上がありません"
              : "売上がまだありません"
          }
          description="上のフォームから通帳の入金を記録してください。"
        />
      ) : (
        <TableCard>
          <Table>
            <THead>
              <Th>日付</Th>
              <Th>取引先</Th>
              <Th>摘要</Th>
              <Th align="right">金額</Th>
              <Th>出所</Th>
              <Th>
                <span className="sr-only">操作</span>
              </Th>
            </THead>
            <TBody>
              {revenues.map((revenue) => (
                <Tr key={revenue.id}>
                  <Td muted numeric nowrap>
                    {formatJpDate(revenue.date)}
                  </Td>
                  <Td className="max-w-xs truncate">
                    {revenue.partyName || "—"}
                  </Td>
                  <Td muted className="max-w-xs truncate">
                    {revenue.description || "—"}
                  </Td>
                  <Td align="right" numeric className="font-medium">
                    {formatYen(revenue.amount)}
                  </Td>
                  <Td muted className="text-xs">
                    {revenue.source}
                  </Td>
                  <Td align="right">
                    <DeleteRevenueButton id={revenue.id} />
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </TableCard>
      )}
    </div>
  );
}
