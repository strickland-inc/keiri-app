import { ACCOUNT, ledger, usedAccounts } from "@/domain/accounting";
import { formatJpDate } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page-header";
import {
  Table,
  TableCard,
  TBody,
  Td,
  Th,
  THead,
  Tr,
} from "@/components/ui/table";
import {
  Amount,
  AccountPills,
  FiscalYearTabs,
  tableFootRowClass,
} from "../_components";
import { ledgerHref, loadAccounting } from "../_lib";
import { requirePageSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function LedgerPage({
  searchParams,
}: {
  searchParams: Promise<{ fy?: string; account?: string }>;
}) {
  await requirePageSession();
  const { fy: fyParam, account: accountParam } = await searchParams;
  const { journal, fy, years } = await loadAccounting(fyParam);

  const accounts = usedAccounts(journal);
  const account =
    accountParam && accounts.includes(accountParam)
      ? accountParam
      : (accounts.find((a) => a === ACCOUNT.cash) ??
        accounts[0] ??
        ACCOUNT.cash);
  const book = ledger(journal, account, { from: fy.from, to: fy.to });

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="総勘定元帳"
        actions={
          <FiscalYearTabs
            years={years}
            current={fy}
            basePath="/accounting/ledger"
            extra={{ account }}
          />
        }
      />

      {accounts.length > 0 && (
        <AccountPills
          accounts={accounts}
          current={account}
          hrefFor={(name) => ledgerHref(name, fy.year)}
        />
      )}

      <TableCard>
        <Table>
          <THead>
            <Th>日付</Th>
            <Th>摘要</Th>
            <Th align="right">借方</Th>
            <Th align="right">貸方</Th>
            <Th align="right">残高</Th>
          </THead>
          <TBody>
            <Tr>
              <Td />
              <Td muted>前期繰越</Td>
              <Td />
              <Td />
              <Td align="right">
                <Amount value={book.opening} />
              </Td>
            </Tr>
            {book.rows.map((row) => (
              <Tr key={`${row.entry.id}-${row.balance}`}>
                <Td nowrap numeric muted>
                  {formatJpDate(row.entry.date)}
                </Td>
                <Td>{row.entry.description}</Td>
                <Td align="right">
                  <Amount value={row.debit} />
                </Td>
                <Td align="right">
                  <Amount value={row.credit} />
                </Td>
                <Td align="right">
                  <Amount value={row.balance} />
                </Td>
              </Tr>
            ))}
          </TBody>
          <tfoot>
            <tr className={tableFootRowClass}>
              <Td />
              <Td>合計 / 期末残高</Td>
              <Td align="right">
                <Amount value={book.totalDebit} />
              </Td>
              <Td align="right">
                <Amount value={book.totalCredit} />
              </Td>
              <Td align="right">
                <Amount value={book.closing} />
              </Td>
            </tr>
          </tfoot>
        </Table>
      </TableCard>
    </div>
  );
}
