import { redirect } from "next/navigation";
import { SectionCard } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { requirePageSession } from "@/lib/session";
import { getRepositories } from "@/repositories";
import { CreateTokenForm } from "./create-token-form";
import { RevokeTokenButton } from "./revoke-button";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await requirePageSession();
  if (session.role !== "admin") redirect("/");

  const repos = await getRepositories();
  const tokens = await repos.apiTokens.list();

  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <PageHeader title="API トークン" />

      <SectionCard title="トークンを発行">
        <CreateTokenForm />
      </SectionCard>

      <SectionCard title="発行済みのトークン">
        {tokens.length === 0 ? (
          <EmptyState icon="key" title="トークンはまだありません" />
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {tokens.map((token) => (
              <li
                key={token.id}
                className="flex items-center justify-between gap-4 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{token.name}</p>
                  <p className="text-xs text-ink-muted">
                    発行: {new Date(token.createdAt).toLocaleString("ja-JP")}
                  </p>
                </div>
                <RevokeTokenButton id={token.id} name={token.name} />
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
