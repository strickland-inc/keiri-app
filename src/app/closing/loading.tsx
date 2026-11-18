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

export default function ClosingLoading(): ReactElement {
  return (
    <div className="flex flex-col gap-8">
      {/* 見出しと期のタブ */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-8 w-16" />
          <Skeleton className="h-4 w-56" />
        </div>
        <Skeleton className="h-10 w-48 rounded-full" />
      </div>

      {/* 売上高・販管費・営業利益 */}
      <div className="grid gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i} className="p-5">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-2 h-8 w-32" />
          </Card>
        ))}
      </div>

      {/* 月別カバレッジ */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
        {Array.from({ length: 12 }).map((_, i) => (
          <Card key={i} className="p-3">
            <Skeleton className="h-3 w-10" />
            <Skeleton className="mt-1 h-4 w-16" />
          </Card>
        ))}
      </div>

      {/* 内訳書 */}
      <TableCard>
        <Table>
          <THead>
            {["w-20", "w-16", "w-16"].map((width, i) => (
              <Th key={i}>
                <Skeleton className={`h-3 ${width}`} />
              </Th>
            ))}
          </THead>
          <TBody>
            {Array.from({ length: 6 }).map((_, i) => (
              <Tr key={i}>
                <Td>
                  <Skeleton className="h-4 w-20" />
                </Td>
                <Td>
                  <Skeleton className="ml-auto h-4 w-16" />
                </Td>
                <Td>
                  <Skeleton className="ml-auto h-4 w-10" />
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </TableCard>
    </div>
  );
}
