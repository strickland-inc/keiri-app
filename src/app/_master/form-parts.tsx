import type { ReactNode } from "react";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";

/** マスタ（取引先・発行元）フォームの 1 区画。見出し + 2 列グリッド。 */
export function FormSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle title={title} />
      </CardHeader>
      <CardBody className="grid gap-4 p-6 sm:grid-cols-2">{children}</CardBody>
    </Card>
  );
}

/** フォーム末尾の操作。主ボタンは「保存する」だけ。 */
export function FormActions({ cancelHref }: { cancelHref: string }) {
  return (
    <div className="flex justify-end gap-3">
      <Link
        href={cancelHref}
        className={buttonVariants({ variant: "secondary" })}
      >
        キャンセル
      </Link>
      <Button type="submit">保存する</Button>
    </div>
  );
}
