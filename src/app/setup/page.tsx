import { redirect } from "next/navigation";
import { isDemoMode } from "@/lib/auth";
import { Alert } from "@/components/ui/alert";
import { countUsers } from "@/lib/setup-state";
import { SetupForm } from "./setup-form";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  if (isDemoMode()) redirect("/");
  const users = await countUsers();
  if (users.ok && users.count > 0) redirect("/login");

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-4">
      <div className="w-full max-w-[360px]">
        <h1 className="mb-2 text-center text-2xl font-semibold tracking-tight">
          最初の管理者を作る
        </h1>
        <p className="mb-8 text-center text-sm text-ink-muted">
          スプレッドシートにつながりました。ログインに使う ID
          とパスワードを決めてください。
        </p>
        {users.ok ? (
          <SetupForm />
        ) : (
          <Alert tone="danger">{users.message}</Alert>
        )}
      </div>
    </div>
  );
}
