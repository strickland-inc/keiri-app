import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { PageHeader } from "@/components/ui/page-header";
import { CsvImport } from "./csv-import";

export const dynamic = "force-dynamic";

export default function ExpenseImportPage() {
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="カード明細の取込"
        description="楽天カードと PayPay の明細 CSV を、選んでいる会社の経費に取り込みます。取り込む前に、費目と件数を確かめられます。"
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
