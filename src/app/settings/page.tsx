import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/card";
import { PushToggle } from "@/components/push-toggle";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  return (
    <div className="flex max-w-2xl flex-col gap-8">
      <PageHeader title="設定" description="通知など、アプリ全体の設定です。" />
      <SectionCard title="プッシュ通知">
        <PushToggle />
      </SectionCard>
    </div>
  );
}
