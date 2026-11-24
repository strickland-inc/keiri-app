import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { PageHeader } from "@/components/ui/page-header";
import { CsvImport } from "./csv-import";
import { requirePageSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function ExpenseImportPage() {
  await requirePageSession();
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="カード明細の取込"
        actions={
          <Link
            href="/expenses"
            className={buttonVariants({ variant: "secondary" })}
          >
            <Icon name="arrow_back" className="text-[18px]" />
            経費へ戻る
          </Link>
        }
      />
      <CsvImport />
    </div>
  );
}
