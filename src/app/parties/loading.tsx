import type { ReactElement } from "react";
import { ListSkeleton } from "@/app/_master/list-skeleton";

export default function PartiesLoading(): ReactElement {
  return (
    <ListSkeleton columns={["w-32", "w-24", "w-36", "w-24", "w-20"]} rows={5} />
  );
}
