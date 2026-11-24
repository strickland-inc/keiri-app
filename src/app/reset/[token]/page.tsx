import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { AuthFrame } from "@/app/login/auth-frame";
import { inspectLink } from "@/lib/auth-server";
import { ResetForm } from "./reset-form";

// トークンつきの URL なので、都度確かめる。応答のキャッシュ禁止は proxy が付ける
export const dynamic = "force-dynamic";

export default async function ResetPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const link = await inspectLink(token, "reset").catch(() => ({
    valid: false as const,
    loginId: undefined,
  }));

  if (!link.valid) {
    return (
      <AuthFrame title="再設定リンクを開けません">
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
    <AuthFrame title="パスワードの再設定">
      {link.loginId && (
        <p className="tabular mb-4 text-center text-sm font-medium">
          {link.loginId}
        </p>
      )}
      <ResetForm token={token} loginId={link.loginId ?? ""} />
    </AuthFrame>
  );
}
