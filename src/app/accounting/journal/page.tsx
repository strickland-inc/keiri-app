import Link from "next/link";
import { entriesInRange, type JournalLine } from "@/domain/accounting";
import { formatJpDate } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Table,
  TableCard,
  TBody,
  Td,
  Th,
  THead,
  Tr,
} from "@/components/ui/table";
import { Amount, AccountingNote, FiscalYearTabs } from "../_components";
import { loadAccounting } from "../_lib";

export const dynamic = "force-dynamic";

export default async function JournalPage({
  searchParams,
}: {
  searchParams: Promise<{ fy?: string }>;
}) {
  const { fy: fyParam } = await searchParams;
  const { journal, fy, years } = await loadAccounting(fyParam);
  const entries = entriesInRange(journal, { from: fy.from, to: fy.to });

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="仕訳帳"
        description={`${fy.label}の仕訳 ${entries.length}件（請求書と経費から自動作成）`}
        actions={
          <FiscalYearTabs
            years={years}
            current={fy}
            basePath="/accounting/journal"
          />
        }
      />

      {entries.length === 0 ? (
        <EmptyState icon="menu_book" title="この期間の仕訳はありません" />
      ) : (
        <TableCard>
          <Table>
            <THead>
              <Th>日付</Th>
              <Th>借方</Th>
              <Th align="right">金額</Th>
              <Th>貸方</Th>
              <Th align="right">金額</Th>
              <Th>摘要</Th>
            </THead>
            <TBody>
              {entries.map((entry) => {
                const debits = entry.lines.filter((l) => l.side === "debit");
                const credits = entry.lines.filter((l) => l.side === "credit");
                return (
                  <Tr key={entry.id} className="align-top">
                    <Td nowrap numeric muted>
                      {formatJpDate(entry.date)}
                    </Td>
                    <Td nowrap>
                      <AccountNames lines={debits} />
                    </Td>
                    <Td align="right">
                      <LineAmounts lines={debits} />
                    </Td>
                    <Td nowrap>
                      <AccountNames lines={credits} />
                    </Td>
                    <Td align="right">
                      <LineAmounts lines={credits} />
                    </Td>
                    <Td>
                      {entry.href ? (
                        <Link
                          href={entry.href}
                          className="text-ink underline-offset-2 hover:underline"
                        >
                          {entry.description}
                        </Link>
                      ) : (
                        entry.description
                      )}
                    </Td>
                  </Tr>
                );
              })}
            </TBody>
          </Table>
        </TableCard>
      )}

      <AccountingNote />
    </div>
  );
}

function AccountNames({ lines }: { lines: readonly JournalLine[] }) {
  return lines.map((l) => <div key={l.account}>{l.account}</div>);
}

function LineAmounts({ lines }: { lines: readonly JournalLine[] }) {
  return lines.map((l) => (
    <div key={l.account}>
      <Amount value={l.amount} />
    </div>
  ));
}
