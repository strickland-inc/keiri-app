import assert from "node:assert/strict";
import test from "node:test";
import type {
  ExpenseRepository,
  SettingsRepository,
} from "../repositories/types.ts";
import { loadMoneySnapshot } from "./money-snapshot-service.ts";

const expenses: ExpenseRepository = {
  async list() {
    return [
      {
        id: "expense-1",
        date: "2026-07-02",
        merchant: "非公開加盟店",
        amount: 50_000,
        category: "要確認",
        source: "テスト",
        note: "",
        createdAt: "2026-07-02T00:00:00.000Z",
        updatedAt: "2026-07-02T00:00:00.000Z",
      },
    ];
  },
  async get() {
    return null;
  },
  async create() {
    throw new Error("not used");
  },
  async bulkCreate() {
    throw new Error("not used");
  },
  async update() {
    throw new Error("not used");
  },
  async remove() {
    throw new Error("not used");
  },
};

const settings: SettingsRepository = {
  async get(key) {
    if (key !== "money_plan:2026-07") return null;
    return JSON.stringify({
      targetAmount: 200_000,
      bufferAmount: 5_000,
      variableForecastAmount: 10_000,
      plannedCommitments: [],
    });
  },
  async set() {
    throw new Error("not used");
  },
  async all() {
    return {};
  },
};

test("Repositoryから集計済みMoneySnapshotだけを構築する", async () => {
  const snapshot = await loadMoneySnapshot(
    { expenses, settings },
    "2026-07",
    "2026-07-20T12:00:00.000Z",
  );

  assert.equal(snapshot.totals.forecastAmount, 65_000);
  assert.equal(snapshot.totals.safeToSpendAmount, 135_000);
  assert.equal(JSON.stringify(snapshot).includes("非公開加盟店"), false);
});

test("不正な月をRepositoryアクセス前に拒否する", async () => {
  await assert.rejects(
    () => loadMoneySnapshot({ expenses, settings }, "2026-13"),
    /month must be YYYY-MM/,
  );
});
