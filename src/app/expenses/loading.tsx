import type { ReactElement } from "react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableCard,
  TBody,
  Td,
  Th,
  THead,
  Tr,
} from "@/components/ui/table";

export default function ExpensesLoading(): ReactElement {
  return (
    <div className="flex flex-col gap-8">
      {/* 見出しと操作 */}
      <div className="flex items-center justify-between gap-3">
        <Skeleton className="h-8 w-20" />
        <Skeleton className="h-10 w-44 rounded-full" />
      </div>

      {/* 期間タブと検索 */}
      <div className="flex flex-col gap-4">
        <Skeleton className="h-10 w-72 rounded-full" />
        <Skeleton className="h-56 rounded-2xl" />
      </div>

      {/* 合計 */}
      <Card className="p-5">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="mt-2 h-8 w-40" />
        <div className="mt-5 grid grid-cols-2 gap-x-8 gap-y-2 border-t border-line pt-4 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between gap-2">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-3 w-16 shrink-0" />
            </div>
          ))}
        </div>
      </Card>

      {/* 一覧 */}
      <TableCard>
        <Table>
          <THead>
            {["w-20", "w-32", "w-24", "w-20", "w-16"].map((width, i) => (
              <Th key={i}>
                <Skeleton className={`h-3 ${width}`} />
              </Th>
            ))}
          </THead>
          <TBody>
            {Array.from({ length: 8 }).map((_, i) => (
              <Tr key={i}>
                <Td>
                  <Skeleton className="h-4 w-20" />
                </Td>
                <Td>
                  <Skeleton className="h-4 w-40" />
                </Td>
                <Td>
                  <Skeleton className="ml-auto h-4 w-20" />
                </Td>
                <Td>
                  <Skeleton className="h-10 w-36 rounded-[var(--radius)]" />
                </Td>
                <Td>
                  <Skeleton className="h-3 w-16" />
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </TableCard>
    </div>
  );
}
