import type { ReactElement } from "react";
import { ListSkeleton } from "@/app/_master/list-skeleton";

export default function IssuersLoading(): ReactElement {
  return (
    <ListSkeleton
      hasDescription
      columns={["w-32", "w-36", "w-36", "w-12", "w-20"]}
      rows={3}
    />
  );
}
