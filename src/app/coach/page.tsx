import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Stat } from "@/components/ui/stat";
import { formatYen } from "@/domain/money";
import {
  formatPlannedCommitmentsText,
  parseMoneyPlan,
} from "@/domain/money-coach";
import { loadMoneySnapshot } from "@/lib/money-snapshot-service";
import { getRepositories } from "@/repositories";
import { saveMoneyPlan } from "./actions";

export const dynamic = "force-dynamic";

function currentMonthInTokyo(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  return `${parts.find((part) => part.type === "year")?.value}-${parts.find((part) => part.type === "month")?.value}`;
}

function Breakdown({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-xs text-ink-muted">{label}</p>
      <p className="mt-0.5 font-semibold tabular text-ink">
        {formatYen(value)}
      </p>
    </div>
  );
}

export default async function CoachPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}): Promise<React.ReactElement> {
  const query = await searchParams;
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(query.month ?? "")
    ? String(query.month)
    : currentMonthInTokyo();
  const repos = await getRepositories();
  const [snapshot, rawPlan] = await Promise.all([
    loadMoneySnapshot(repos, month),
    repos.settings.get(`money_plan:${month}`),
  ]);
  const plan = parseMoneyPlan(month, rawPlan);
  const { totals, goal } = snapshot;
  const safe = totals.safeToSpendAmount;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="今月のお金"
        description="Web の画面とエージェント向け API が、同じ集計結果を参照します。"
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat
          label="引落目標"
          value={
            goal.targetAmount === null ? "未設定" : formatYen(goal.targetAmount)
          }
        />
        <Stat label="着地予測" value={formatYen(totals.forecastAmount)} />
        <Stat
          label="安全に使える金額"
          value={safe === null ? "目標を設定してください" : formatYen(safe)}
          tone={safe !== null && safe < 0 ? "negative" : "positive"}
        />
      </div>

      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-ink">予測の内訳</h2>
        </CardHeader>
        <CardBody className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-5">
          <Breakdown label="確定済み" value={totals.confirmedAmount} />
          <Breakdown label="未確定" value={totals.provisionalAmount} />
          <Breakdown
            label="今後の固定費"
            value={totals.plannedCommitmentsAmount}
          />
          <Breakdown
            label="変動費見込み"
            value={totals.variableForecastAmount}
          />
          <Breakdown label="安全余白" value={goal.bufferAmount} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-ink">月間計画</h2>
        </CardHeader>
        <CardBody>
          <form action={saveMoneyPlan} className="grid gap-5 sm:grid-cols-2">
            <Field label="対象月" htmlFor="coach-month">
              <Input
                id="coach-month"
                type="month"
                name="month"
                defaultValue={month}
                required
              />
            </Field>
            <Field label="引落目標" htmlFor="coach-target">
              <Input
                id="coach-target"
                type="number"
                name="targetAmount"
                min="0"
                defaultValue={plan.targetAmount ?? ""}
                required
              />
            </Field>
            <Field label="安全余白" htmlFor="coach-buffer">
              <Input
                id="coach-buffer"
                type="number"
                name="bufferAmount"
                min="0"
                defaultValue={plan.bufferAmount}
              />
            </Field>
            <Field label="今後の変動費見込み" htmlFor="coach-variable">
              <Input
                id="coach-variable"
                type="number"
                name="variableForecastAmount"
                min="0"
                defaultValue={plan.variableForecastAmount}
              />
            </Field>
            <Field
              label="今後請求される固定費"
              htmlFor="coach-commitments"
              hint="基本は「名称,金額,self」。サブスクは末尾に「subscription,active」を加えます。本人負担外はotherです。"
              className="sm:col-span-2"
            >
              <Textarea
                id="coach-commitments"
                name="plannedCommitments"
                defaultValue={formatPlannedCommitmentsText(
                  plan.plannedCommitments,
                )}
                placeholder={
                  "家賃,45000,self\nChatGPT,3000,self,subscription,active\nSoftBank Air,5000,other"
                }
                rows={5}
                className="font-mono"
              />
            </Field>
            <div className="sm:col-span-2">
              <Button type="submit">計画を保存して再計算</Button>
            </div>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
