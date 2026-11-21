import type {
  BankTransactionRepository,
  DocumentFilter,
  DocumentRepository,
  ExpenseFilter,
  ApiTokenRepository,
  ExpenseRepository,
  IssuerRepository,
  MerchantRuleRepository,
  PartyRepository,
  Repositories,
  RevenueFilter,
  RevenueRepository,
  SettingsRepository,
  UserRepository,
} from "../types";
import type {
  DocumentRecord,
  DocumentType,
  NewDocumentInput,
} from "@/domain/documents";
import type { NewPartyInput, Party } from "@/domain/party";
import type { Issuer, NewIssuerInput } from "@/domain/issuer";
import type { User, NewUserInput } from "@/domain/user";
import type { Expense, NewExpenseInput } from "@/domain/expense";
import type { MerchantRule, NewMerchantRule } from "@/domain/merchant";
import type { BankTransaction, NewBankTransactionInput } from "@/domain/bank";
import type { NewRevenueInput, Revenue } from "@/domain/revenue";
import type { ApiToken, NewApiTokenInput } from "@/domain/api-token";
import { formatNumber, parseSeq } from "@/domain/numbering";
import { counterKey, matchesCompany } from "../scope";
import {
  readAll,
  appendRow,
  appendRows,
  updateRowById,
  upsertRowById,
  deleteRowById,
  incrementCounter,
} from "./sheetsApi";
import {
  SHEET_NAMES,
  documentToRow,
  rowToDocument,
  partyToRow,
  rowToParty,
  issuerToRow,
  rowToIssuer,
  userToRow,
  rowToUser,
  expenseToRow,
  rowToExpense,
  merchantRuleToRow,
  rowToMerchantRule,
  bankTransactionToRow,
  rowToBankTransaction,
  revenueToRow,
  rowToRevenue,
  apiTokenToRow,
  rowToApiToken,
} from "./schema";

function uuid(): string {
  return globalThis.crypto.randomUUID();
}

function now(): string {
  return new Date().toISOString();
}

/** 1つのシートと、行・ドメイン型の相互変換。id は 1 列目に置く。 */
interface SheetCodec<T> {
  sheet: string;
  /** 「見つかりません」のエラー文に使う名前。 */
  label: string;
  toRow: (record: T) => string[];
  fromRow: (row: string[]) => T;
}

async function findRow(sheet: string, id: string): Promise<string[] | null> {
  const rows = await readAll(sheet);
  return rows.find((r) => r[0] === id) ?? null;
}

async function getRecord<T>(
  codec: SheetCodec<T>,
  id: string,
): Promise<T | null> {
  const row = await findRow(codec.sheet, id);
  return row ? codec.fromRow(row) : null;
}

/** 現在の行を patch で上書きして保存する。id は patch で書き換えさせない。 */
async function patchRecord<T extends { id: string; updatedAt: string }>(
  codec: SheetCodec<T>,
  id: string,
  patch: Partial<T>,
): Promise<T> {
  const row = await findRow(codec.sheet, id);
  if (!row) throw new Error(`${codec.label}が見つかりません: ${id}`);
  const updated: T = { ...codec.fromRow(row), ...patch, id, updatedAt: now() };
  await updateRowById(codec.sheet, id, codec.toRow(updated));
  return updated;
}

async function removeRecord(sheet: string, id: string): Promise<void> {
  await deleteRowById(sheet, id);
}

const documentCodec: SheetCodec<DocumentRecord> = {
  sheet: SHEET_NAMES.documents,
  label: "帳票",
  toRow: documentToRow,
  fromRow: rowToDocument,
};
const partyCodec: SheetCodec<Party> = {
  sheet: SHEET_NAMES.parties,
  label: "取引先",
  toRow: partyToRow,
  fromRow: rowToParty,
};
const issuerCodec: SheetCodec<Issuer> = {
  sheet: SHEET_NAMES.issuers,
  label: "発行元",
  toRow: issuerToRow,
  fromRow: rowToIssuer,
};
const userCodec: SheetCodec<User> = {
  sheet: SHEET_NAMES.users,
  label: "ユーザー",
  toRow: userToRow,
  fromRow: rowToUser,
};
const expenseCodec: SheetCodec<Expense> = {
  sheet: SHEET_NAMES.expenses,
  label: "経費",
  toRow: expenseToRow,
  fromRow: rowToExpense,
};
const revenueCodec: SheetCodec<Revenue> = {
  sheet: SHEET_NAMES.revenues,
  label: "売上",
  toRow: revenueToRow,
  fromRow: rowToRevenue,
};

// ── DocumentRepository ────────────────────────────────────────────────────────

const documentRepo: DocumentRepository = {
  async list(filter?: DocumentFilter): Promise<DocumentRecord[]> {
    const rows = await readAll(SHEET_NAMES.documents);
    let docs = rows.map(rowToDocument);
    if (filter) docs = docs.filter((d) => matchesCompany(d.issuerId, filter));
    if (filter?.type) docs = docs.filter((d) => d.type === filter.type);
    if (filter?.partyId)
      docs = docs.filter((d) => d.partyId === filter.partyId);
    if (filter?.status) docs = docs.filter((d) => d.status === filter.status);
    return docs.sort((a, b) => (a.issueDate < b.issueDate ? 1 : -1));
  },

  async get(id: string): Promise<DocumentRecord | null> {
    return getRecord(documentCodec, id);
  },

  async create(input: NewDocumentInput): Promise<DocumentRecord> {
    const floor = await documentRepo.maxSeq(input.issuerId, input.type);
    const record = await documentRepo.draft(input, floor);
    await appendRow(SHEET_NAMES.documents, documentToRow(record));
    return record;
  },

  async maxSeq(issuerId: string, type: DocumentType): Promise<number> {
    const rows = await readAll(SHEET_NAMES.documents);
    return rows
      .map(rowToDocument)
      .filter((d) => d.issuerId === issuerId && d.type === type)
      .reduce((max, d) => Math.max(max, parseSeq(d.number) ?? 0), 0);
  },

  async draft(input: NewDocumentInput, floor: number): Promise<DocumentRecord> {
    const ts = now();
    // 会社ごとに 0001 から始まる連番にする。カウンター行がまだ無い会社では、
    // その会社の既存帳票の最大番号（floor）の続きから振る。
    const seq = await incrementCounter(
      counterKey(input.issuerId, input.type),
      floor,
    );
    return {
      ...input,
      id: uuid(),
      number: formatNumber(input.type, seq),
      status: input.status ?? "draft",
      createdAt: ts,
      updatedAt: ts,
    };
  },

  async update(
    id: string,
    patch: Partial<DocumentRecord>,
  ): Promise<DocumentRecord> {
    return patchRecord(documentCodec, id, patch);
  },

  async remove(id: string): Promise<void> {
    await removeRecord(SHEET_NAMES.documents, id);
  },
};

// ── PartyRepository ───────────────────────────────────────────────────────────

const partyRepo: PartyRepository = {
  async list(): Promise<Party[]> {
    const rows = await readAll(SHEET_NAMES.parties);
    return rows
      .map(rowToParty)
      .sort((a, b) => a.name.localeCompare(b.name, "ja"));
  },

  async get(id: string): Promise<Party | null> {
    return getRecord(partyCodec, id);
  },

  async create(input: NewPartyInput): Promise<Party> {
    const ts = now();
    const record: Party = {
      ...input,
      id: uuid(),
      createdAt: ts,
      updatedAt: ts,
    };
    await appendRow(SHEET_NAMES.parties, partyToRow(record));
    return record;
  },

  async update(id: string, patch: Partial<Party>): Promise<Party> {
    return patchRecord(partyCodec, id, patch);
  },

  async remove(id: string): Promise<void> {
    await removeRecord(SHEET_NAMES.parties, id);
  },
};

// ── IssuerRepository ──────────────────────────────────────────────────────────

const issuerRepo: IssuerRepository = {
  async list(): Promise<Issuer[]> {
    const rows = await readAll(SHEET_NAMES.issuers);
    return rows.map(rowToIssuer);
  },

  async get(id: string): Promise<Issuer | null> {
    return getRecord(issuerCodec, id);
  },

  async getDefault(): Promise<Issuer | null> {
    const rows = await readAll(SHEET_NAMES.issuers);
    const issuers = rows.map(rowToIssuer);
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
    await appendRow(SHEET_NAMES.issuers, issuerToRow(record));
    return record;
  },

  async update(id: string, patch: Partial<Issuer>): Promise<Issuer> {
    return patchRecord(issuerCodec, id, patch);
  },

  async remove(id: string): Promise<void> {
    await removeRecord(SHEET_NAMES.issuers, id);
  },
};

// ── UserRepository ────────────────────────────────────────────────────────────

const userRepo: UserRepository = {
  async list(): Promise<User[]> {
    const rows = await readAll(SHEET_NAMES.users);
    return rows.map(rowToUser);
  },

  async get(id: string): Promise<User | null> {
    return getRecord(userCodec, id);
  },

  async findByLoginId(loginId: string): Promise<User | null> {
    const rows = await readAll(SHEET_NAMES.users);
    const row = rows.find((r) => r[1] === loginId);
    return row ? rowToUser(row) : null;
  },

  async create(input: NewUserInput): Promise<User> {
    const ts = now();
    const record: User = { ...input, id: uuid(), createdAt: ts, updatedAt: ts };
    await appendRow(SHEET_NAMES.users, userToRow(record));
    return record;
  },

  async remove(id: string): Promise<void> {
    await removeRecord(SHEET_NAMES.users, id);
  },
};

// ── ExpenseRepository ─────────────────────────────────────────────────────────

const expenseRepo: ExpenseRepository = {
  async list(filter?: ExpenseFilter): Promise<Expense[]> {
    const rows = await readAll(SHEET_NAMES.expenses);
    let expenses = rows.map(rowToExpense);
    if (filter)
      expenses = expenses.filter((e) => matchesCompany(e.issuerId, filter));
    if (filter?.month) {
      const m = filter.month;
      expenses = expenses.filter((e) => e.date.startsWith(m));
    }
    if (filter?.category) {
      const cat = filter.category;
      expenses = expenses.filter((e) => e.category === cat);
    }
    return expenses.sort((a, b) => (a.date < b.date ? 1 : -1));
  },

  async get(id: string): Promise<Expense | null> {
    return getRecord(expenseCodec, id);
  },

  async create(input: NewExpenseInput): Promise<Expense> {
    const ts = now();
    const record: Expense = {
      ...input,
      id: uuid(),
      createdAt: ts,
      updatedAt: ts,
    };
    await appendRow(SHEET_NAMES.expenses, expenseToRow(record));
    return record;
  },

  async bulkCreate(inputs: NewExpenseInput[]): Promise<Expense[]> {
    const ts = now();
    const records = inputs.map((input): Expense => ({
      ...input,
      id: uuid(),
      createdAt: ts,
      updatedAt: ts,
    }));
    await appendRows(SHEET_NAMES.expenses, records.map(expenseToRow));
    return records;
  },

  async update(id: string, patch: Partial<Expense>): Promise<Expense> {
    return patchRecord(expenseCodec, id, patch);
  },

  async remove(id: string): Promise<void> {
    await removeRecord(SHEET_NAMES.expenses, id);
  },
};

// ── SettingsRepository ────────────────────────────────────────────────────────

const settingsRepo: SettingsRepository = {
  async get(key: string): Promise<string | null> {
    const rows = await readAll(SHEET_NAMES.settings);
    const row = rows.find((r) => r[0] === key);
    return row ? (row[1] ?? null) : null;
  },

  async set(key: string, value: string): Promise<void> {
    await upsertRowById(SHEET_NAMES.settings, key, [key, value, now()]);
  },

  async all(): Promise<Record<string, string>> {
    const rows = await readAll(SHEET_NAMES.settings);
    return Object.fromEntries(rows.map((r) => [r[0] ?? "", r[1] ?? ""]));
  },
};

// ── MerchantRuleRepository（自己学習辞書）──────────────────────────────────────

const merchantRuleRepo: MerchantRuleRepository = {
  async all(): Promise<MerchantRule[]> {
    const rows = await readAll(SHEET_NAMES.merchantRules);
    return rows.map(rowToMerchantRule);
  },

  async get(key: string): Promise<MerchantRule | null> {
    const rows = await readAll(SHEET_NAMES.merchantRules);
    const row = rows.find((r) => r[0] === key);
    return row ? rowToMerchantRule(row) : null;
  },

  async upsert(input: NewMerchantRule): Promise<MerchantRule> {
    const rule: MerchantRule = { ...input, updatedAt: now() };
    await upsertRowById(
      SHEET_NAMES.merchantRules,
      input.key,
      merchantRuleToRow(rule),
    );
    return rule;
  },
};

// ── BankTransactionRepository（銀行明細）─────────────────────────────────────

const bankTransactionRepo: BankTransactionRepository = {
  async list(): Promise<BankTransaction[]> {
    const rows = await readAll(SHEET_NAMES.bankTransactions);
    return rows
      .map(rowToBankTransaction)
      .sort((a, b) => b.date.localeCompare(a.date) || b.seq - a.seq);
  },

  async get(id: string): Promise<BankTransaction | null> {
    const rows = await readAll(SHEET_NAMES.bankTransactions);
    const row = rows.find((r) => r[0] === id);
    return row ? rowToBankTransaction(row) : null;
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
    await appendRows(
      SHEET_NAMES.bankTransactions,
      records.map(bankTransactionToRow),
    );
    return records;
  },

  async update(
    id: string,
    patch: Partial<BankTransaction>,
  ): Promise<BankTransaction> {
    const rows = await readAll(SHEET_NAMES.bankTransactions);
    const row = rows.find((r) => r[0] === id);
    if (!row) throw new Error(`銀行明細が見つかりません: ${id}`);
    const updated: BankTransaction = {
      ...rowToBankTransaction(row),
      ...patch,
      id,
      updatedAt: now(),
    };
    await updateRowById(
      SHEET_NAMES.bankTransactions,
      id,
      bankTransactionToRow(updated),
    );
    return updated;
  },

  async remove(id: string): Promise<void> {
    await deleteRowById(SHEET_NAMES.bankTransactions, id);
  },
};

// ── RevenueRepository（売上台帳）───────────────────────────────────────────────

const revenueRepo: RevenueRepository = {
  async list(filter?: RevenueFilter): Promise<Revenue[]> {
    const rows = await readAll(SHEET_NAMES.revenues);
    let revenues = rows.map(rowToRevenue);
    if (filter)
      revenues = revenues.filter((r) => matchesCompany(r.issuerId, filter));
    if (filter?.from) revenues = revenues.filter((r) => r.date >= filter.from!);
    if (filter?.to) revenues = revenues.filter((r) => r.date <= filter.to!);
    return revenues.sort((a, b) => (a.date < b.date ? 1 : -1));
  },

  async get(id: string): Promise<Revenue | null> {
    return getRecord(revenueCodec, id);
  },

  async create(input: NewRevenueInput): Promise<Revenue> {
    const ts = now();
    const record: Revenue = {
      ...input,
      id: uuid(),
      createdAt: ts,
      updatedAt: ts,
    };
    await appendRow(SHEET_NAMES.revenues, revenueToRow(record));
    return record;
  },

  async bulkCreate(inputs: NewRevenueInput[]): Promise<Revenue[]> {
    const ts = now();
    const records = inputs.map((input): Revenue => ({
      ...input,
      id: uuid(),
      createdAt: ts,
      updatedAt: ts,
    }));
    // Workers の外部通信の上限（1 リクエスト 50 回）に掛からないよう、1 回の append にまとめる。
    await appendRows(SHEET_NAMES.revenues, records.map(revenueToRow));
    return records;
  },

  async update(id: string, patch: Partial<Revenue>): Promise<Revenue> {
    return patchRecord(revenueCodec, id, patch);
  },

  async remove(id: string): Promise<void> {
    await removeRecord(SHEET_NAMES.revenues, id);
  },
};

// ── ApiTokenRepository ────────────────────────────────────────────────────────

const apiTokenRepo: ApiTokenRepository = {
  async list(): Promise<ApiToken[]> {
    const rows = await readAll(SHEET_NAMES.apiTokens);
    return rows.map(rowToApiToken);
  },

  async create(input: NewApiTokenInput): Promise<ApiToken> {
    const record: ApiToken = { ...input, id: uuid(), createdAt: now() };
    await appendRow(SHEET_NAMES.apiTokens, apiTokenToRow(record));
    return record;
  },

  async remove(id: string): Promise<void> {
    await removeRecord(SHEET_NAMES.apiTokens, id);
  },
};

// ── Export ────────────────────────────────────────────────────────────────────

export const sheetsRepositories: Repositories = {
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
  backend: "sheets",
};
