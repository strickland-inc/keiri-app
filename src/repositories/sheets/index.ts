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
  InviteRepository,
  AuditRepository,
  AuthCounterRepository,
} from "../types";
import type {
  DocumentRecord,
  DocumentType,
  NewDocumentInput,
} from "@/domain/documents";
import type { NewPartyInput, Party } from "@/domain/party";
import type { Issuer, NewIssuerInput } from "@/domain/issuer";
import { normalizeLoginId } from "@/domain/user";
import type { User, NewUserInput } from "@/domain/user";
import type { Invite, NewInviteInput } from "@/domain/invite";
import {
  AUDIT_LIST_MAX,
  type AuditEntry,
  type AuditFilter,
  type NewAuditEntry,
} from "@/domain/audit";
import {
  applyAccessPatch,
  applyProfilePatch,
  applySecurityPatch,
  clearTotp,
  emptyAccess,
  emptyProfile,
  emptySecurity,
  mergeUser,
  versionKey,
  type AccessPatch,
  type AccessRow,
  type ProfilePatch,
  type ProfileRow,
  type SecurityPatch,
  type SecurityRow,
  type UserRow,
  type VersionSide,
} from "../user-merge";
import { isStaleFailKey, PRUNE_LIMIT } from "../auth-counters";
import type { Expense, NewExpenseInput } from "@/domain/expense";
import type { MerchantRule, NewMerchantRule } from "@/domain/merchant";
import type { BankTransaction, NewBankTransactionInput } from "@/domain/bank";
import type { NewRevenueInput, Revenue } from "@/domain/revenue";
import type { ApiToken, NewApiTokenInput } from "@/domain/api-token";
import type { GatewayCall } from "@/lib/gateway";
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
  sendToSheet,
  nextSeqIn,
  nextSeqMany,
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
  profileToRow,
  rowToProfile,
  securityToRow,
  rowToSecurity,
  accessToRow,
  rowToAccess,
  inviteToRow,
  rowToInvite,
  auditToRow,
  rowToAudit,
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

interface UserTables {
  users: UserRow[];
  profiles: Map<string, ProfileRow>;
  security: Map<string, SecurityRow>;
  access: Map<string, AccessRow>;
  versions: Map<string, number>;
}

/** 5 つのタブを読む（小さい表なので、1 回の通信でまとめて読まれる）。 */
async function readUserTables(): Promise<UserTables> {
  const [userRows, profileRows, securityRows, accessRows, versionRows] =
    await Promise.all([
      readAll(SHEET_NAMES.users),
      readAll(SHEET_NAMES.userProfiles),
      readAll(SHEET_NAMES.userSecurity),
      readAll(SHEET_NAMES.userAccess),
      readAll(SHEET_NAMES.sessionVersions),
    ]);
  const byId = <T>(rows: string[][], parse: (row: string[]) => T) =>
    new Map(rows.map((r) => [r[0] ?? "", parse(r)] as const));
  return {
    users: userRows.map(rowToUser).filter((u) => u.id !== ""),
    profiles: byId(profileRows, rowToProfile),
    security: byId(securityRows, rowToSecurity),
    access: byId(accessRows, rowToAccess),
    versions: new Map(
      versionRows.map(
        (r) => [r[0] ?? "", Number.parseInt(r[1] ?? "", 10) || 0] as const,
      ),
    ),
  };
}

function mergeFrom(t: UserTables, u: UserRow): User {
  return mergeUser(
    u,
    t.profiles.get(u.id),
    t.security.get(u.id),
    t.access.get(u.id),
    {
      admin: t.versions.get(versionKey("admin", u.id)) ?? 0,
      self: t.versions.get(versionKey("self", u.id)) ?? 0,
    },
  );
}

function bumpCall(side: VersionSide, id: string): GatewayCall {
  return {
    op: "nextSeq",
    tab: SHEET_NAMES.sessionVersions,
    key: versionKey(side, id),
    floor: 0,
  };
}

/** 書き込み前に読み直したユーザー。書いたあとの値は、読み直して返す（版数は nextSeq の結果なので）。 */
async function reread(id: string): Promise<User> {
  const t = await readUserTables();
  const row = t.users.find((u) => u.id === id);
  if (!row) throw new Error(`ユーザーが見つかりません: ${id}`);
  return mergeFrom(t, row);
}

async function userTablesFor(id: string): Promise<{
  tables: UserTables;
  row: UserRow;
}> {
  const tables = await readUserTables();
  const row = tables.users.find((u) => u.id === id);
  if (!row) throw new Error(`ユーザーが見つかりません: ${id}`);
  return { tables, row };
}

const userRepo: UserRepository = {
  async list(): Promise<User[]> {
    const t = await readUserTables();
    return t.users.map((u) => mergeFrom(t, u));
  },

  async get(id: string): Promise<User | null> {
    const t = await readUserTables();
    const row = t.users.find((u) => u.id === id);
    return row ? mergeFrom(t, row) : null;
  },

  async findByLoginId(loginId: string): Promise<User | null> {
    const wanted = normalizeLoginId(loginId);
    const t = await readUserTables();
    const row = t.users.find((u) => normalizeLoginId(u.loginId) === wanted);
    return row ? mergeFrom(t, row) : null;
  },

  async create(input: NewUserInput): Promise<User> {
    const ts = now();
    const id = uuid();
    const userRow: UserRow = {
      id,
      loginId: normalizeLoginId(input.loginId),
      passwordHash: input.passwordHash,
      role: input.role,
      createdAt: ts,
      updatedAt: ts,
    };
    const profile: ProfileRow = {
      id,
      displayName: input.displayName,
      updatedAt: ts,
    };
    const security: SecurityRow = {
      ...emptySecurity(id),
      passwordHash: input.passwordHash,
      passwordChangedAt: ts,
      updatedAt: ts,
    };
    // users に行を足してから、ほかのタブに書く（users に無い id の行を作らないため）
    await sendToSheet([
      { op: "append", tab: SHEET_NAMES.users, rows: [userToRow(userRow)] },
      {
        op: "upsertById",
        tab: SHEET_NAMES.userProfiles,
        id,
        row: profileToRow(profile),
      },
      {
        op: "upsertById",
        tab: SHEET_NAMES.userSecurity,
        id,
        row: securityToRow(security),
      },
    ]);
    return mergeUser(userRow, profile, security, undefined, {
      admin: 0,
      self: 0,
    });
  },

  async remove(id: string): Promise<void> {
    await sendToSheet([
      { op: "deleteById", tab: SHEET_NAMES.users, id },
      { op: "deleteById", tab: SHEET_NAMES.userProfiles, id },
      { op: "deleteById", tab: SHEET_NAMES.userSecurity, id },
      { op: "deleteById", tab: SHEET_NAMES.userAccess, id },
      {
        op: "deleteById",
        tab: SHEET_NAMES.sessionVersions,
        id: versionKey("admin", id),
      },
      {
        op: "deleteById",
        tab: SHEET_NAMES.sessionVersions,
        id: versionKey("self", id),
      },
    ]);
  },

  async updateProfile(id: string, patch: ProfilePatch): Promise<User> {
    const { tables } = await userTablesFor(id);
    // 書くのは user_profiles の行だけ。ほかの行は、読んだ値で書き直さない
    const next = applyProfilePatch(
      tables.profiles.get(id) ?? emptyProfile(id),
      patch,
      now(),
    );
    await sendToSheet([
      {
        op: "upsertById",
        tab: SHEET_NAMES.userProfiles,
        id,
        row: profileToRow(next),
      },
    ]);
    return reread(id);
  },

  async updateSecurity(id: string, patch: SecurityPatch): Promise<User> {
    const { tables } = await userTablesFor(id);
    const next = applySecurityPatch(
      tables.security.get(id) ?? emptySecurity(id),
      patch,
      now(),
    );
    // 版を先に上げる。あとの書き込みが失敗しても、古い Cookie が残るより締め出すほうが安全
    const calls: GatewayCall[] = [];
    if (patch.bumpSession) calls.push(bumpCall("self", id));
    // 行が無い既存の利用者に updateById を送ると not_found で落ちるので、必ず upsert
    calls.push({
      op: "upsertById",
      tab: SHEET_NAMES.userSecurity,
      id,
      row: securityToRow(next),
    });
    await sendToSheet(calls);
    return reread(id);
  },

  async updateAccess(id: string, patch: AccessPatch): Promise<User> {
    const { tables } = await userTablesFor(id);
    const calls: GatewayCall[] = [];
    if (patch.bumpSession) calls.push(bumpCall("admin", id));
    if (patch.status !== undefined) {
      const next = applyAccessPatch(
        tables.access.get(id) ?? emptyAccess(id),
        patch,
        now(),
      );
      calls.push({
        op: "upsertById",
        tab: SHEET_NAMES.userAccess,
        id,
        row: accessToRow(next),
      });
    }
    if (calls.length > 0) await sendToSheet(calls);
    return reread(id);
  },

  async updateRole(id, role, options): Promise<User> {
    const { row } = await userTablesFor(id);
    const calls: GatewayCall[] = [];
    if (options?.bumpSession) calls.push(bumpCall("admin", id));
    // 書くのは users の行だけ。user_access は書き直さない（無効化と重なっても消えない）
    calls.push({
      op: "updateById",
      tab: SHEET_NAMES.users,
      id,
      row: userToRow({ ...row, role, updatedAt: now() }),
    });
    await sendToSheet(calls);
    return reread(id);
  },

  async resetTotp(id: string): Promise<User> {
    const { tables } = await userTablesFor(id);
    const next = clearTotp(tables.security.get(id) ?? emptySecurity(id), now());
    await sendToSheet([
      bumpCall("admin", id),
      {
        op: "upsertById",
        tab: SHEET_NAMES.userSecurity,
        id,
        row: securityToRow(next),
      },
    ]);
    return reread(id);
  },

  async bumpSessionVersion(id: string, side: VersionSide): Promise<void> {
    await sendToSheet([bumpCall(side, id)]);
  },
};

// ── InviteRepository ──────────────────────────────────────────────────────────

const inviteRepo: InviteRepository = {
  async list(): Promise<Invite[]> {
    return (await readAll(SHEET_NAMES.invites)).map(rowToInvite);
  },
  async get(id: string): Promise<Invite | null> {
    const row = await findRow(SHEET_NAMES.invites, id);
    return row ? rowToInvite(row) : null;
  },
  async findByTokenHash(tokenHash: string): Promise<Invite | null> {
    const rows = await readAll(SHEET_NAMES.invites);
    const row = rows.find((r) => r[2] === tokenHash);
    return row ? rowToInvite(row) : null;
  },
  async create(input: NewInviteInput): Promise<Invite> {
    const record: Invite = {
      ...input,
      id: uuid(),
      createdAt: now(),
      usedAt: "",
    };
    await appendRow(SHEET_NAMES.invites, inviteToRow(record));
    return record;
  },
  async markUsed(id: string, usedAt: string): Promise<void> {
    const row = await findRow(SHEET_NAMES.invites, id);
    if (!row) return;
    await upsertRowById(
      SHEET_NAMES.invites,
      id,
      inviteToRow({ ...rowToInvite(row), usedAt }),
    );
  },
  async remove(id: string): Promise<void> {
    await removeRecord(SHEET_NAMES.invites, id);
  },
};

// ── AuditRepository ───────────────────────────────────────────────────────────

const auditRepo: AuditRepository = {
  async append(entry: NewAuditEntry): Promise<void> {
    const record: AuditEntry = { ...entry, id: uuid(), at: now() };
    await appendRow(SHEET_NAMES.auditLog, auditToRow(record));
  },
  async list(filter?: AuditFilter): Promise<AuditEntry[]> {
    const rows = await readAll(SHEET_NAMES.auditLog);
    const limit = Math.min(filter?.limit ?? AUDIT_LIST_MAX, AUDIT_LIST_MAX);
    return rows
      .map((row, index) => ({ entry: rowToAudit(row), index }))
      .filter(
        ({ entry }) =>
          (!filter?.action || entry.action === filter.action) &&
          (!filter?.actorId || entry.actorId === filter.actorId),
      )
      .sort((a, b) =>
        a.entry.at === b.entry.at
          ? b.index - a.index
          : a.entry.at < b.entry.at
            ? 1
            : -1,
      )
      .slice(0, limit)
      .map(({ entry }) => entry);
  },
};

// ── AuthCounterRepository ─────────────────────────────────────────────────────

const authCounterRepo: AuthCounterRepository = {
  async inspect(keys, nowMs) {
    const rows = await readAll(SHEET_NAMES.authCounters);
    const byKey = new Map(rows.map((r) => [r[0] ?? "", r[1] ?? ""] as const));
    return {
      values: keys.map((key) => Number.parseInt(byKey.get(key) ?? "", 10) || 0),
      stale: [...byKey.keys()]
        .filter((key) => isStaleFailKey(key, nowMs))
        .slice(0, PRUNE_LIMIT),
    };
  },
  next(key, floor = 0) {
    return nextSeqIn(SHEET_NAMES.authCounters, key, floor);
  },
  nextMany(keys) {
    return nextSeqMany(SHEET_NAMES.authCounters, keys);
  },
  async deleteMany(keys) {
    if (keys.length === 0) return;
    await sendToSheet(
      keys.map(
        (id) =>
          ({ op: "deleteById", tab: SHEET_NAMES.authCounters, id }) as const,
      ),
    );
  },
  async prune(nowMs) {
    const rows = await readAll(SHEET_NAMES.authCounters);
    const stale = rows
      .map((r) => r[0] ?? "")
      .filter((key) => isStaleFailKey(key, nowMs))
      .slice(0, PRUNE_LIMIT);
    await authCounterRepo.deleteMany(stale);
  },
  async deleteByPrefix(prefixes) {
    const rows = await readAll(SHEET_NAMES.authCounters);
    const keys = rows
      .map((r) => r[0] ?? "")
      .filter((key) => prefixes.some((prefix) => key.startsWith(prefix)));
    await authCounterRepo.deleteMany(keys);
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
  invites: inviteRepo,
  audit: auditRepo,
  authCounters: authCounterRepo,
  backend: "sheets",
};
