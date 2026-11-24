import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { AuthFrame } from "@/app/login/auth-frame";
import { isDemoAuth, isDemoMode } from "@/lib/auth";
import { RecoverForm } from "./recover-form";

export default function RecoverPage() {
  if (isDemoMode()) redirect("/");

  return (
    <AuthFrame title="管理者の復旧">
      <div className="mb-4 flex flex-wrap justify-center gap-2">
        <Badge>2段階認証を解除</Badge>
        <Badge>全端末をログアウト</Badge>
        <Badge>ロックを解除</Badge>
      </div>
      <RecoverForm demo={isDemoAuth()} />
      <p className="mt-8 text-center text-xs text-ink-muted">
        <Link
          href="/login"
          className="underline underline-offset-2 hover:text-ink"
        >
          ログインへ戻る
        </Link>
      </p>
    </AuthFrame>
  );
}
