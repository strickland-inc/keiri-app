import { Skeleton } from "@/components/ui/skeleton";
import {
  TableCard,
  Table,
  THead,
  Th,
  TBody,
  Tr,
  Td,
} from "@/components/ui/table";

/** 一覧画面の読み込み中表示（見出し + 表）。列幅は Tailwind の w-* で渡す。 */
export function ListSkeleton({
  hasDescription,
  columns,
  rows,
}: {
  hasDescription?: boolean;
  columns: string[];
  rows: number;
}) {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-start justify-between gap-6">
        <div>
          <Skeleton className="h-8 w-32" />
          {hasDescription && <Skeleton className="mt-2 h-4 w-64" />}
        </div>
        <Skeleton className="h-10 w-28 rounded-full" />
      </div>

      <TableCard>
        <Table>
          <THead>
            {columns.map((w, i) => (
              <Th key={i}>
                <Skeleton className={`h-3 ${w}`} />
              </Th>
            ))}
          </THead>
          <TBody>
            {Array.from({ length: rows }).map((_, r) => (
              <Tr key={r}>
                {columns.map((w, c) => (
                  <Td key={c}>
                    <Skeleton className={`h-4 ${w}`} />
                  </Td>
                ))}
              </Tr>
            ))}
          </TBody>
        </Table>
      </TableCard>
    </div>
  );
}
