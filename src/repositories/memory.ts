/**
 * InMemory Repository。接続コードが未設定でも、デモデータでアプリを動かせるようにする。
 * デモ用のシードデータを持つ。サーバーレスでは揮発しうる（永続が必要なら Sheets/DB へ）。
 */
import {
  type DocumentRecord,
  type NewDocumentInput,
  type DocumentType,
} from "@/domain/documents";
import { formatNumber, parseSeq } from "@/domain/numbering";
import type { NewPartyInput, Party } from "@/domain/party";
import type { Issuer, NewIssuerInput } from "@/domain/issuer";
import type { User, NewUserInput } from "@/domain/user";
import type { ApiToken, NewApiTokenInput } from "@/domain/api-token";
import type { Expense, NewExpenseInput } from "@/domain/expense";
import type { MerchantRule, NewMerchantRule } from "@/domain/merchant";
import type { NewRevenueInput, Revenue } from "@/domain/revenue";
import { counterKey, matchesCompany, nextSequence } from "./scope";
import type { BankTransaction, NewBankTransactionInput } from "@/domain/bank";
import type {
  ApiTokenRepository,
  BankTransactionRepository,
  DocumentFilter,
  DocumentRepository,
  ExpenseFilter,
  ExpenseRepository,
  IssuerRepository,
  MerchantRuleRepository,
  PartyRepository,
  Repositories,
  RevenueFilter,
  RevenueRepository,
  SettingsRepository,
  UserRepository,
} from "./types";

function uuid(): string {
  return globalThis.crypto.randomUUID();
}

function now(): string {
  return new Date().toISOString();
}

interface StoredRecord {
  id: string;
  updatedAt: string;
}

/** id が一致する行を patch で更新して返す。id は patch で書き換えさせない。 */
function patchById<T extends StoredRecord>(
  rows: T[],
  id: string,
  patch: Partial<T>,
  notFoundMessage: string,
): T {
  const idx = rows.findIndex((row) => row.id === id);
  if (idx < 0) throw new Error(`${notFoundMessage}: ${id}`);
  const updated: T = { ...rows[idx], ...patch, id, updatedAt: now() };
  rows[idx] = updated;
  return updated;
}

/** id が一致する行を取り除く。無ければ何もしない。 */
function removeById(rows: StoredRecord[], id: string): void {
  const idx = rows.findIndex((row) => row.id === id);
  if (idx >= 0) rows.splice(idx, 1);
}

// ──────────────────────────────────────────────────────────
// シードデータ
// ──────────────────────────────────────────────────────────
// 会社（発行元）のシード。Sheets 未接続のデモモードでも会社の切替を試せるように
// 2社入れておく。住所・振込先などの実データは画面の「会社」から登録する。
const seedIssuers: Issuer[] = [
  {
    id: "issuer-sample",
    name: "合同会社サンプル",
    postalCode: "123-4567",
    address: "東京都サンプル区1-2-3",
    building: "",
    isDefault: true,
    fiscalYearEndMonth: 9,
    firstFiscalYearEnd: "2023-09-30",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "issuer-demo",
    name: "株式会社デモ",
    isDefault: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
];

const seedParties: Party[] = [
  {
    id: "party-1",
    name: "株式会社サンプル商事",
    contactName: "山田 太郎",
    honorific: "様",
    postalCode: "123-9876",
    address: "東京都サンプル区北テスト町5丁目12-34 サンプルタワー9F",
    email: "yamada@example.com",
    defaultTitle: "システム開発業務",
    createdAt: "2026-01-05T00:00:00.000Z",
    updatedAt: "2026-01-05T00:00:00.000Z",
  },
  {
    id: "party-2",
    name: "テスト工業株式会社",
    contactName: "鈴木 花子",
    honorific: "御中",
    postalCode: "100-0001",
    address: "東京都千代田区1-1-1",
    email: "info@example.com",
    defaultTitle: "コンサルティング業務",
    createdAt: "2026-02-10T00:00:00.000Z",
    updatedAt: "2026-02-10T00:00:00.000Z",
  },
];

const seedDocuments: DocumentRecord[] = [
  {
    id: "doc-1",
    type: "invoice",
    number: "0001",
    issueDate: "2026-05-31",
    issuerId: "issuer-sample",
    partyId: "party-1",
    title: "システム開発業務",
    items: [
      {
        name: "システム開発作業費",
        quantity: 1,
        unit: "式",
        unitPrice: 30000,
        taxRate: 0.1,
      },
      {
        name: "コンサルティング業務費",
        quantity: 1,
        unit: "式",
        unitPrice: 18000,
        taxRate: 0.1,
      },
      {
        name: "保守サポート費",
        quantity: 1,
        unit: "式",
        unitPrice: 12000,
        taxRate: 0.1,
      },
      {
        name: "データ分析レポート作成費",
        quantity: 1,
        unit: "式",
        unitPrice: 15000,
        taxRate: 0.1,
      },
    ],
    notes: "",
    status: "sent",
    dueDate: "2026-06-30",
    createdAt: "2026-05-31T00:00:00.000Z",
    updatedAt: "2026-05-31T00:00:00.000Z",
  },
  {
    id: "doc-2",
    type: "invoice",
    number: "0002",
    issueDate: "2026-06-15",
    issuerId: "issuer-sample",
    partyId: "party-2",
    title: "コンサルティング業務",
    items: [
      {
        name: "顧問料（6月分）",
        quantity: 1,
        unit: "式",
        unitPrice: 100000,
        taxRate: 0.1,
      },
    ],
    notes: "翌月末払い",
    status: "issued",
    dueDate: "2026-07-31",
    createdAt: "2026-06-15T00:00:00.000Z",
    updatedAt: "2026-06-15T00:00:00.000Z",
  },
  {
    id: "doc-3",
    type: "quote",
    number: "0001",
    issueDate: "2026-06-10",
    issuerId: "issuer-sample",
    partyId: "party-1",
    title: "新規サイト構築",
    items: [
      {
        name: "要件定義",
        quantity: 1,
        unit: "式",
        unitPrice: 200000,
        taxRate: 0.1,
      },
      {
        name: "デザイン・実装",
        quantity: 1,
        unit: "式",
        unitPrice: 600000,
        taxRate: 0.1,
      },
    ],
    notes: "",
    status: "draft",
    validUntil: "2026-07-10",
    paymentTerms: "月末締め翌月末払い",
    createdAt: "2026-06-10T00:00:00.000Z",
    updatedAt: "2026-06-10T00:00:00.000Z",
  },
  {
    id: "doc-4",
    type: "invoice",
    number: "0001",
    issueDate: "2026-06-20",
    issuerId: "issuer-demo",
    partyId: "party-2",
    title: "AI 導入支援",
    items: [
      {
        name: "AI 導入支援（6月分）",
        quantity: 1,
        unit: "式",
        unitPrice: 250000,
        taxRate: 0.1,
      },
    ],
    notes: "",
    status: "issued",
    dueDate: "2026-07-31",
    createdAt: "2026-06-20T00:00:00.000Z",
    updatedAt: "2026-06-20T00:00:00.000Z",
  },
];

// ──────────────────────────────────────────────────────────
// ストア（モジュールスコープ）
// ──────────────────────────────────────────────────────────
const documents: DocumentRecord[] = seedDocuments.map((d) => ({
  ...d,
  items: [...d.items],
}));
const parties: Party[] = [...seedParties];
const issuers: Issuer[] = seedIssuers.map((i) => ({ ...i }));

/** 採番は会社ごと・帳票種別ごとの通し連番。会社が違えば 0001 から始まる。 */
const counters = new Map<string, number>();

function nextSeq(issuerId: string, type: DocumentType): number {
  const key = counterKey(issuerId, type);
  const fromDocuments = documents
    .filter((d) => d.issuerId === issuerId && d.type === type)
    .map((d) => parseSeq(d.number) ?? 0)
    .reduce((a, b) => Math.max(a, b), 0);
  const next = nextSequence(counters.get(key) ?? 0, fromDocuments);
  counters.set(key, next);
  return next;
}

const documentRepo: DocumentRepository = {
  async list(filter?: DocumentFilter): Promise<DocumentRecord[]> {
    let rows = [...documents];
    if (filter) rows = rows.filter((d) => matchesCompany(d.issuerId, filter));
    if (filter?.type) rows = rows.filter((d) => d.type === filter.type);
    if (filter?.partyId)
      rows = rows.filter((d) => d.partyId === filter.partyId);
    if (filter?.status) rows = rows.filter((d) => d.status === filter.status);
    return rows.sort((a, b) => (a.issueDate < b.issueDate ? 1 : -1));
  },
  async get(id: string): Promise<DocumentRecord | null> {
    return documents.find((d) => d.id === id) ?? null;
  },
  async create(input: NewDocumentInput): Promise<DocumentRecord> {
    const record = await documentRepo.draft(input, 0);
    documents.push(record);
    return record;
  },
  async maxSeq(issuerId: string, type: DocumentType): Promise<number> {
    return documents
      .filter((d) => d.issuerId === issuerId && d.type === type)
      .reduce((max, d) => Math.max(max, parseSeq(d.number) ?? 0), 0);
  },
  async draft(input: NewDocumentInput): Promise<DocumentRecord> {
    const ts = now();
    return {
      ...input,
      id: uuid(),
      number: formatNumber(input.type, nextSeq(input.issuerId, input.type)),
      status: input.status ?? "draft",
      createdAt: ts,
      updatedAt: ts,
    };
  },
  async update(
    id: string,
    patch: Partial<DocumentRecord>,
  ): Promise<DocumentRecord> {
    return patchById(documents, id, patch, "書類が見つかりません");
  },
  async remove(id: string): Promise<void> {
    removeById(documents, id);
  },
};

const partyRepo: PartyRepository = {
  async list(): Promise<Party[]> {
    return [...parties].sort((a, b) => a.name.localeCompare(b.name, "ja"));
  },
  async get(id: string): Promise<Party | null> {
    return parties.find((p) => p.id === id) ?? null;
  },
  async create(input: NewPartyInput): Promise<Party> {
    const ts = now();
    const record: Party = {
      ...input,
      id: uuid(),
      createdAt: ts,
      updatedAt: ts,
    };
    parties.push(record);
    return record;
  },
  async update(id: string, patch: Partial<Party>): Promise<Party> {
    return patchById(parties, id, patch, "取引先が見つかりません");
  },
  async remove(id: string): Promise<void> {
    removeById(parties, id);
  },
};

const issuerRepo: IssuerRepository = {
  async list(): Promise<Issuer[]> {
    return [...issuers];
  },
  async get(id: string): Promise<Issuer | null> {
    return issuers.find((i) => i.id === id) ?? null;
  },
  async getDefault(): Promise<Issuer | null> {
    return issuers.find((i) => i.isDefault) ?? issuers[0] ?? null;
  },
  async create(input: NewIssuerInput): Promise<Issuer> {
    const ts = now();
    const record: Issuer = {
      ...input,
      id: uuid(),
      createdAt: ts,
      updatedAt: ts,
    };
    issuers.push(record);
    return record;
  },
  async update(id: string, patch: Partial<Issuer>): Promise<Issuer> {
    return patchById(issuers, id, patch, "発行元が見つかりません");
  },
  async remove(id: string): Promise<void> {
    removeById(issuers, id);
  },
};

const users: User[] = [];

const userRepo: UserRepository = {
  async list(): Promise<User[]> {
    return [...users];
  },
  async get(id: string): Promise<User | null> {
    return users.find((u) => u.id === id) ?? null;
  },
  async findByLoginId(loginId: string): Promise<User | null> {
    return users.find((u) => u.loginId === loginId) ?? null;
  },
  async create(input: NewUserInput): Promise<User> {
    const ts = now();
    const record: User = { ...input, id: uuid(), createdAt: ts, updatedAt: ts };
    users.push(record);
    return record;
  },
  async remove(id: string): Promise<void> {
    removeById(users, id);
  },
};

const expenseStore: Expense[] = [];

const expenseRepo: ExpenseRepository = {
  async list(filter?: ExpenseFilter): Promise<Expense[]> {
    let rows = [...expenseStore];
    if (filter) rows = rows.filter((e) => matchesCompany(e.issuerId, filter));
    if (filter?.month) {
      const m = filter.month;
      rows = rows.filter((e) => e.date.startsWith(m));
    }
    if (filter?.category) {
      const cat = filter.category;
      rows = rows.filter((e) => e.category === cat);
    }
    return rows.sort((a, b) => (a.date < b.date ? 1 : -1));
  },
  async get(id: string): Promise<Expense | null> {
    return expenseStore.find((e) => e.id === id) ?? null;
  },
  async create(input: NewExpenseInput): Promise<Expense> {
    const ts = now();
    const record: Expense = {
      ...input,
      id: uuid(),
      createdAt: ts,
      updatedAt: ts,
    };
    expenseStore.push(record);
    return record;
  },
  async bulkCreate(inputs: NewExpenseInput[]): Promise<Expense[]> {
    return Promise.all(inputs.map((input) => expenseRepo.create(input)));
  },
  async update(id: string, patch: Partial<Expense>): Promise<Expense> {
    return patchById(expenseStore, id, patch, "経費が見つかりません");
  },
  async remove(id: string): Promise<void> {
    removeById(expenseStore, id);
  },
};

const settingsStore = new Map<string, string>();

const settingsRepo: SettingsRepository = {
  async get(key: string): Promise<string | null> {
    return settingsStore.get(key) ?? null;
  },
  async set(key: string, value: string): Promise<void> {
    settingsStore.set(key, value);
  },
  async all(): Promise<Record<string, string>> {
    return Object.fromEntries(settingsStore);
  },
};

const merchantRuleStore = new Map<string, MerchantRule>();

const merchantRuleRepo: MerchantRuleRepository = {
  async all(): Promise<MerchantRule[]> {
    return [...merchantRuleStore.values()];
  },
  async get(key: string): Promise<MerchantRule | null> {
    return merchantRuleStore.get(key) ?? null;
  },
  async upsert(input: NewMerchantRule): Promise<MerchantRule> {
    const rule: MerchantRule = { ...input, updatedAt: now() };
    merchantRuleStore.set(input.key, rule);
    return rule;
  },
};

const bankTransactionStore: BankTransaction[] = [];

const bankTransactionRepo: BankTransactionRepository = {
  async list(): Promise<BankTransaction[]> {
    return [...bankTransactionStore].sort(
      (a, b) => b.date.localeCompare(a.date) || b.seq - a.seq,
    );
  },
  async get(id: string): Promise<BankTransaction | null> {
    return bankTransactionStore.find((t) => t.id === id) ?? null;
  },
  async bulkCreate(
    inputs: NewBankTransactionInput[],
  ): Promise<BankTransaction[]> {
    const ts = now();
    const records = inputs.map((input): BankTransaction => ({
      ...input,
      id: uuid(),
      createdAt: ts,
      updatedAt: ts,
    }));
    bankTransactionStore.push(...records);
    return records;
  },
  async update(
    id: string,
    patch: Partial<BankTransaction>,
  ): Promise<BankTransaction> {
    const idx = bankTransactionStore.findIndex((t) => t.id === id);
    if (idx < 0) throw new Error(`銀行明細が見つかりません: ${id}`);
    const updated: BankTransaction = {
      ...bankTransactionStore[idx],
      ...patch,
      id,
      updatedAt: now(),
    };
    bankTransactionStore[idx] = updated;
    return updated;
  },
  async remove(id: string): Promise<void> {
    const idx = bankTransactionStore.findIndex((t) => t.id === id);
    if (idx >= 0) bankTransactionStore.splice(idx, 1);
  },
};

// 売上台帳のデモ行。帳票（請求書）が無い入金を通帳から拾った想定。
const seedRevenues: Revenue[] = [
  {
    id: "revenue-1",
    issuerId: "issuer-sample",
    date: "2025-05-20",
    partyName: "株式会社サンプル商事",
    amount: 88000,
    description: "システム開発業務 入金",
    source: "通帳",
    createdAt: "2025-05-20T00:00:00.000Z",
    updatedAt: "2025-05-20T00:00:00.000Z",
  },
  {
    id: "revenue-2",
    issuerId: "issuer-sample",
    date: "2025-06-30",
    partyName: "テスト工業株式会社",
    amount: 100000,
    description: "顧問料（6月分）",
    source: "通帳",
    createdAt: "2025-06-30T00:00:00.000Z",
    updatedAt: "2025-06-30T00:00:00.000Z",
  },
  {
    id: "revenue-3",
    issuerId: "issuer-sample",
    date: "2025-08-15",
    partyName: "個人 山本",
    amount: 45000,
    description: "スポット相談",
    source: "通帳",
    createdAt: "2025-08-15T00:00:00.000Z",
    updatedAt: "2025-08-15T00:00:00.000Z",
  },
];

const revenueStore: Revenue[] = seedRevenues.map((r) => ({ ...r }));

const revenueRepo: RevenueRepository = {
  async list(filter?: RevenueFilter): Promise<Revenue[]> {
    let rows = [...revenueStore];
    if (filter) rows = rows.filter((r) => matchesCompany(r.issuerId, filter));
    if (filter?.from) rows = rows.filter((r) => r.date >= filter.from!);
    if (filter?.to) rows = rows.filter((r) => r.date <= filter.to!);
    return rows.sort((a, b) => (a.date < b.date ? 1 : -1));
  },
  async get(id: string): Promise<Revenue | null> {
    return revenueStore.find((r) => r.id === id) ?? null;
  },
  async create(input: NewRevenueInput): Promise<Revenue> {
    const ts = now();
    const record: Revenue = {
      ...input,
      id: uuid(),
      createdAt: ts,
      updatedAt: ts,
    };
    revenueStore.push(record);
    return record;
  },
  async bulkCreate(inputs: NewRevenueInput[]): Promise<Revenue[]> {
    return Promise.all(inputs.map((input) => revenueRepo.create(input)));
  },
  async update(id: string, patch: Partial<Revenue>): Promise<Revenue> {
    return patchById(revenueStore, id, patch, "売上が見つかりません");
  },
  async remove(id: string): Promise<void> {
    removeById(revenueStore, id);
  },
};

const apiTokens: ApiToken[] = [];

const apiTokenRepo: ApiTokenRepository = {
  async list(): Promise<ApiToken[]> {
    return [...apiTokens];
  },
  async create(input: NewApiTokenInput): Promise<ApiToken> {
    const record: ApiToken = { ...input, id: uuid(), createdAt: now() };
    apiTokens.push(record);
    return record;
  },
  async remove(id: string): Promise<void> {
    const index = apiTokens.findIndex((token) => token.id === id);
    if (index >= 0) apiTokens.splice(index, 1);
  },
};

export const memoryRepositories: Repositories = {
  documents: documentRepo,
  parties: partyRepo,
  issuers: issuerRepo,
  users: userRepo,
  expenses: expenseRepo,
  settings: settingsRepo,
  merchantRules: merchantRuleRepo,
  bankTransactions: bankTransactionRepo,
  revenues: revenueRepo,
  apiTokens: apiTokenRepo,
  backend: "memory",
};
