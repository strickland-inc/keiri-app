import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { AuthFrame } from "@/app/login/auth-frame";
import { ROLE_LABELS } from "@/domain/user";
import { inspectLink } from "@/lib/auth-server";
import { InviteForm } from "./invite-form";

// トークンつきの URL なので、都度確かめる。応答のキャッシュ禁止は proxy が付ける
export const dynamic = "force-dynamic";

const ROLE_LABEL = ROLE_LABELS;

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  // 無効・期限切れ・使用済みは、理由を分けずに同じ文言で断る
  const link = await inspectLink(token, "invite").catch(() => ({
    valid: false as const,
  }));

  if (!link.valid) {
    return (
      <AuthFrame title="招待リンクを開けません">
        <Alert tone="danger">このリンクは無効か、期限が切れています。</Alert>
        <Link
          href="/login"
          className={buttonVariants({ variant: "secondary" }) + " mt-4 w-full"}
        >
          ログイン画面へ
        </Link>
      </AuthFrame>
    );
  }

  return (
    <AuthFrame title="KEIRI への招待">
      {link.role && (
        <div className="mb-4 flex justify-center">
          <Badge tone="brand">{ROLE_LABEL[link.role]}</Badge>
        </div>
      )}
      <InviteForm token={token} />
    </AuthFrame>
  );
}
