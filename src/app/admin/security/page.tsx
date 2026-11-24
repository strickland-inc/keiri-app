import { redirect } from "next/navigation";
import { isTotpRequired, listUsers } from "@/lib/auth-server";
import { requirePageSession } from "@/lib/session";
import { Badge } from "@/components/ui/badge";
import { SectionCard } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { RequireTotpForm } from "./require-totp-form";

export const dynamic = "force-dynamic";

export default async function SecurityPage() {
  const session = await requirePageSession();
  if (session.role !== "admin") redirect("/");

  const [required, users] = await Promise.all([isTotpRequired(), listUsers()]);
  const me = users.find((u) => u.id === session.sub);
  const without = users.filter((u) => u.status === "active" && !u.totpEnabled);

  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <PageHeader title="セキュリティ" />

      <SectionCard title="2段階認証の必須化">
        <div className="flex flex-col gap-5">
          <RequireTotpForm
            required={required}
            canEnable={me?.totpEnabled ?? false}
          />
          <div className="flex flex-col gap-3 border-t border-line pt-4">
            <h3 className="text-sm font-semibold">必須にすると</h3>
            <div className="flex flex-wrap gap-2">
              <Badge>未設定の人はログアウト</Badge>
              <Badge>次のログインで設定</Badge>
              <Badge>本人は解除できない</Badge>
            </div>
            <p className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-ink-muted">未設定</span>
              <Badge tone={without.length > 0 ? "warning" : "success"}>
                {without.length} 人
              </Badge>
              {without.length > 0 && (
                <span className="text-ink-muted">
                  {without.map((u) => u.displayName).join("、")}
                </span>
              )}
            </p>
          </div>
        </div>
      </SectionCard>
    </div>
  );
}
