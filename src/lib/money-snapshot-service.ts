import {
  calculateMoneySnapshot,
  parseMoneyPlan,
  type MoneySnapshot,
} from "../domain/money-coach.ts";
import type {
  ExpenseRepository,
  SettingsRepository,
} from "../repositories/types.ts";
import { moneyPlanRevision } from "./money-write-service.ts";

interface MoneySnapshotRepositories {
  expenses: ExpenseRepository;
  settings: SettingsRepository;
}

export async function loadMoneySnapshot(
  repositories: MoneySnapshotRepositories,
  month: string,
  asOf: string = new Date().toISOString(),
): Promise<MoneySnapshot> {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new Error("month must be YYYY-MM");
  }
  const [expenses, rawPlan] = await Promise.all([
    repositories.expenses.list(),
    repositories.settings.get(`money_plan:${month}`),
  ]);
  return {
    ...calculateMoneySnapshot(expenses, parseMoneyPlan(month, rawPlan), asOf),
    planRevision: moneyPlanRevision(rawPlan),
  };
}
