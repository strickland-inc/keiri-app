import { redirect } from "next/navigation";
import { isDemoAuth, isDemoMode } from "@/lib/auth";
import { Alert } from "@/components/ui/alert";
import { countUsers } from "@/lib/setup-state";
import { AuthFrame } from "@/app/login/auth-frame";
import { SetupForm } from "./setup-form";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  if (isDemoMode()) redirect("/");
  const users = await countUsers();
  if (users.ok && users.count > 0) redirect("/login");

  return (
    <AuthFrame title="最初の管理者を作る">
      {users.ok ? (
        <SetupForm demo={isDemoAuth()} />
      ) : (
        <Alert tone="danger">{users.message}</Alert>
      )}
    </AuthFrame>
  );
}
