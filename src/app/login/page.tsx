import Link from "next/link";
import { redirect } from "next/navigation";
import { isDemoMode } from "@/lib/auth";
import { currentSession } from "@/lib/session";
import { countUsers } from "@/lib/setup-state";
import { sitePath } from "@/lib/site-path";
import { Alert } from "@/components/ui/alert";
import { AuthFrame } from "./auth-frame";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; reset?: string; recovered?: string }>;
}) {
  if (isDemoMode()) redirect("/");
  const sp = await searchParams;
  const next = sitePath(sp.next ?? "/");

  // ログイン済みなら、ログイン画面を見せずに先へ進める
  const session = await currentSession().catch(() => null);
  if (session) redirect(next);

  // ユーザーが 1 人もいなければ、最初の管理者を作る画面へ送る。
  const users = await countUsers();
  if (users.ok && users.count === 0) redirect("/setup");

  return (
    <AuthFrame title="KEIRI にログイン">
      {!users.ok && (
        <Alert tone="danger" className="mb-4">
          {users.message}
        </Alert>
      )}
      {sp.reset === "1" && (
        <Alert tone="success" className="mb-4">
          パスワードを変えました
        </Alert>
      )}
      {sp.recovered === "1" && (
        <Alert tone="success" className="mb-4">
          管理者のパスワードを入れ替えました
        </Alert>
      )}
      <LoginForm next={next} />
      <p className="mt-8 text-center text-xs text-ink-muted">
        <Link
          href="/recover"
          className="underline underline-offset-2 hover:text-ink"
        >
          管理者の復旧
        </Link>
      </p>
    </AuthFrame>
  );
}
