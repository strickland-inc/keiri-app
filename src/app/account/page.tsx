import { isTotpRequired, listUsers } from "@/lib/auth-server";
import { requirePageSession } from "@/lib/session";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import {
  DisplayNameForm,
  PasswordForm,
  RevokeSessionsCard,
  TotpSection,
} from "./forms";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const session = await requirePageSession();

  // デモ（ログインなしの試用）の利用者は、保存された本人がいない
  if (session.sub === "demo") {
    return (
      <div className="flex max-w-3xl flex-col gap-8">
        <PageHeader title="アカウント" />
        <EmptyState icon="info" title="デモでは使えません" />
      </div>
    );
  }

  const [users, required] = await Promise.all([listUsers(), isTotpRequired()]);
  const me = users.find((u) => u.id === session.sub);

  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <PageHeader title="アカウント" />
      <DisplayNameForm
        displayName={session.displayName}
        loginId={session.loginId}
      />
      <PasswordForm />
      <TotpSection enabled={me?.totpEnabled ?? false} required={required} />
      <RevokeSessionsCard />
    </div>
  );
}
