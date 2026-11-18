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

export default function RevenuesLoading(): ReactElement {
  return (
    <div className="flex flex-col gap-8">
      {/* 見出し */}
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-16" />
        <Skeleton className="h-4 w-72" />
      </div>

      {/* 追加フォーム */}
      <Skeleton className="h-40 rounded-2xl" />

      {/* 絞り込み */}
      <Skeleton className="h-24 rounded-2xl" />

      {/* 合計 */}
      <Card className="p-5">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="mt-2 h-8 w-40" />
      </Card>

      {/* 一覧 */}
      <TableCard>
        <Table>
          <THead>
            {["w-16", "w-24", "w-32", "w-16", "w-12", "w-8"].map((width, i) => (
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
                  <Skeleton className="h-4 w-32" />
                </Td>
                <Td>
                  <Skeleton className="h-4 w-40" />
                </Td>
                <Td>
                  <Skeleton className="ml-auto h-4 w-20" />
                </Td>
                <Td>
                  <Skeleton className="h-3 w-12" />
                </Td>
                <Td>
                  <Skeleton className="ml-auto h-8 w-8 rounded-full" />
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </TableCard>
    </div>
  );
}
