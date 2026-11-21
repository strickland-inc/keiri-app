import { buttonVariants } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

/** 帳票のタブから書き出した PDF を保存するリンク。 */
export function PdfDownloadButton({ documentId }: { documentId: string }) {
  return (
    <a
      href={`/api/documents/${documentId}/pdf`}
      className={buttonVariants({ variant: "secondary", size: "sm" })}
    >
      <Icon name="download" className="text-[16px]" />
      PDF
    </a>
  );
}
