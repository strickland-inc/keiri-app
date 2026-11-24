import type { DocumentRecord, LineItem } from "@/domain/documents";
import type { Party } from "@/domain/party";
import type { Issuer } from "@/domain/issuer";
import type { UserRole, UserStatus } from "@/domain/user";
import type { Invite, InviteKind } from "@/domain/invite";
import type { AuditActorType, AuditEntry } from "@/domain/audit";
import type {
  AccessRow,
  ProfileRow,
  SecurityRow,
  UserRow,
} from "../user-merge";
import {
  type Expense,
  type ExpenseCategory,
  isExpenseCategory,
} from "@/domain/expense";
import type { MerchantRule } from "@/domain/merchant";
import type { BankTransaction, ClassifyMethod } from "@/domain/bank";
import type { Revenue } from "@/domain/revenue";
import type { ApiToken } from "@/domain/api-token";

/**
 * Google Sheets の列定義と、行（文字列の配列）とドメイン型の相互変換。
 * 列の順番は既存シートのデータと対応している。列を足すときは必ず末尾に足し、
 * 途中に挿入しない。xxxToRow と rowToXxx は同じ順番で読み書きする。
 */
export const SHEET_NAMES = {
  documents: "documents",
  parties: "parties",
  issuers: "issuers",
  users: "users",
  counters: "counters",
  expenses: "expenses",
  settings: "settings",
  merchantRules: "merchant_rules",
  bankTransactions: "bank_transactions",
  revenues: "revenues",
  apiTokens: "api_tokens",
  userProfiles: "user_profiles",
  userSecurity: "user_security",
  userAccess: "user_access",
  authCounters: "auth_counters",
  sessionVersions: "session_versions",
  invites: "invites",
  auditLog: "audit_log",
} as const;

export const DOCUMENTS_HEADERS = [
  "id",
  "type",
  "number",
  "issueDate",
  "issuerId",
  "partyId",
  "title",
  "itemsJson",
  "notes",
  "status",
  "dueDate",
  "validUntil",
  "paymentTerms",
  "purpose",
  "createdAt",
  "updatedAt",
  "pdfUrl",
  "templateSpreadsheetId",
  "generatedSpreadsheetId",
  "generatedSheetId",
  "generatedSheetName",
  "sheetUrl",
] as const;

export const PARTIES_HEADERS = [
  "id",
  "name",
  "contactName",
  "honorific",
  "postalCode",
  "address",
  "email",
  "phone",
  "registrationNumber",
  "defaultTitle",
  "createdAt",
  "updatedAt",
] as const;

export const ISSUERS_HEADERS = [
  "id",
  "name",
  "postalCode",
  "address",
  "building",
  "phone",
  "email",
  "registrationNumber",
  "bankInfo",
  "sealImageUrl",
  "isDefault",
  "createdAt",
  "updatedAt",
  // N・O は決算情報（期末月・第1期の期末日）、P は記載名義。本番のシートの列の位置に合わせている。
  "fiscalYearEndMonth",
  "firstFiscalYearEnd",
  "signatoryName",
] as const;

/**
 * 採番カウンター。key 列は会社ごとに独立させるため `<issuerId>:<帳票種別>` を入れる。
 * 会社導入前に作られた `<帳票種別>` だけの行は使わなくなるが、消さずに残す。
 * 列名は既存シートとの互換のため "type" のまま据え置いている。
 */
export const COUNTERS_HEADERS = ["type", "seq"] as const;

export const SETTINGS_HEADERS = ["key", "value", "updatedAt"] as const;

export const MERCHANT_RULES_HEADERS = [
  "key",
  "sampleMerchant",
  "category",
  "updatedAt",
] as const;

/** 未設定を空セルとして書く。 */
function s(v: string | undefined | null): string {
  return v ?? "";
}

/** 空セルを未設定として読む。列が後から増えた既存行もこれで読める。 */
function opt(v: string): string | undefined {
  return v === "" ? undefined : v;
}

// ── DocumentRecord ────────────────────────────────────────────────────────────

export function documentToRow(doc: DocumentRecord): string[] {
  return [
    doc.id,
    doc.type,
    doc.number,
    doc.issueDate,
    doc.issuerId,
    doc.partyId,
    doc.title,
    JSON.stringify(doc.items),
    doc.notes,
    doc.status,
    s(doc.dueDate),
    s(doc.validUntil),
    s(doc.paymentTerms),
    s(doc.purpose),
    doc.createdAt,
    doc.updatedAt,
    s(doc.pdfUrl),
    s(doc.templateSpreadsheetId),
    s(doc.generatedSpreadsheetId),
    s(doc.generatedSheetId),
    s(doc.generatedSheetName),
    s(doc.sheetUrl),
  ];
}

export function rowToDocument(row: string[]): DocumentRecord {
  const g = (i: number): string => row[i] ?? "";
  let items: LineItem[] = [];
  try {
    const raw = g(7);
    if (raw) items = JSON.parse(raw) as LineItem[];
  } catch {
    // 手で壊れた JSON が入っても読めるよう、明細なしとして扱う
  }
  return {
    id: g(0),
    type: g(1) as DocumentRecord["type"],
    number: g(2),
    issueDate: g(3),
    issuerId: g(4),
    partyId: g(5),
    title: g(6),
    items,
    notes: g(8),
    status: g(9) as DocumentRecord["status"],
    dueDate: opt(g(10)),
    validUntil: opt(g(11)),
    paymentTerms: opt(g(12)),
    purpose: opt(g(13)),
    createdAt: g(14),
    updatedAt: g(15),
    pdfUrl: opt(g(16)),
    templateSpreadsheetId: opt(g(17)),
    generatedSpreadsheetId: opt(g(18)),
    generatedSheetId: opt(g(19)),
    generatedSheetName: opt(g(20)),
    sheetUrl: opt(g(21)),
  };
}

// ── Party ─────────────────────────────────────────────────────────────────────

export function partyToRow(party: Party): string[] {
  return [
    party.id,
    party.name,
    s(party.contactName),
    s(party.honorific),
    s(party.postalCode),
    s(party.address),
    s(party.email),
    s(party.phone),
    s(party.registrationNumber),
    s(party.defaultTitle),
    party.createdAt,
    party.updatedAt,
  ];
}

export function rowToParty(row: string[]): Party {
  const g = (i: number): string => row[i] ?? "";
  const honorificRaw = opt(g(3));
  const honorific: Party["honorific"] =
    honorificRaw === "御中" || honorificRaw === "様" ? honorificRaw : undefined;
  return {
    id: g(0),
    name: g(1),
    contactName: opt(g(2)),
    honorific,
    postalCode: opt(g(4)),
    address: opt(g(5)),
    email: opt(g(6)),
    phone: opt(g(7)),
    registrationNumber: opt(g(8)),
    defaultTitle: opt(g(9)),
    createdAt: g(10),
    updatedAt: g(11),
  };
}

// ── Issuer ────────────────────────────────────────────────────────────────────

export function issuerToRow(issuer: Issuer): string[] {
  return [
    issuer.id,
    issuer.name,
    s(issuer.postalCode),
    s(issuer.address),
    s(issuer.building),
    s(issuer.phone),
    s(issuer.email),
    s(issuer.registrationNumber),
    s(issuer.bankInfo),
    s(issuer.sealImageUrl),
    issuer.isDefault ? "TRUE" : "",
    issuer.createdAt,
    issuer.updatedAt,
    issuer.fiscalYearEndMonth === undefined
      ? ""
      : String(issuer.fiscalYearEndMonth),
    s(issuer.firstFiscalYearEnd),
    s(issuer.signatoryName),
  ];
}

export function rowToIssuer(row: string[]): Issuer {
  const g = (i: number): string => row[i] ?? "";
  // 決算月は 1〜12 の整数だけ受け入れ、それ以外は未設定にする。
  const monthNum = Number(g(13));
  const isValidMonth =
    g(13) !== "" &&
    Number.isInteger(monthNum) &&
    monthNum >= 1 &&
    monthNum <= 12;
  const fiscalYearEndMonth = isValidMonth ? monthNum : undefined;
  return {
    id: g(0),
    name: g(1),
    postalCode: opt(g(2)),
    address: opt(g(3)),
    building: opt(g(4)),
    phone: opt(g(5)),
    email: opt(g(6)),
    registrationNumber: opt(g(7)),
    bankInfo: opt(g(8)),
    sealImageUrl: opt(g(9)),
    isDefault: g(10) === "TRUE",
    createdAt: g(11),
    updatedAt: g(12),
    fiscalYearEndMonth,
    firstFiscalYearEnd: opt(g(14)),
    signatoryName: opt(g(15)),
  };
}

// ── User ──────────────────────────────────────────────────────────────────────

export const USERS_HEADERS = [
  "id",
  "loginId",
  "passwordHash",
  "role",
  "createdAt",
  "updatedAt",
] as const;

export function userToRow(user: UserRow): string[] {
  return [
    user.id,
    user.loginId,
    user.passwordHash,
    user.role,
    user.createdAt,
    user.updatedAt,
  ];
}

export function rowToUser(row: string[]): UserRow {
  const g = (i: number): string => row[i] ?? "";
  const role: UserRole = g(3) === "admin" ? "admin" : "user";
  return {
    id: g(0),
    loginId: g(1),
    passwordHash: g(2),
    role,
    createdAt: g(4),
    updatedAt: g(5),
  };
}

// ── UserProfile（Cookie だけで書ける）──────────────────────────────────────────

export const USER_PROFILES_HEADERS = [
  "id",
  "displayName",
  "updatedAt",
] as const;

export function profileToRow(row: ProfileRow): string[] {
  return [row.id, row.displayName, row.updatedAt];
}

export function rowToProfile(row: string[]): ProfileRow {
  const g = (i: number): string => row[i] ?? "";
  return { id: g(0), displayName: g(1), updatedAt: g(2) };
}

// ── UserSecurity（パスワードの再入力・リンク・接続コードを通した操作だけが書く）────

export const USER_SECURITY_HEADERS = [
  "id",
  "passwordHash",
  "passwordChangedAt",
  "totpSecret",
  "totpEnabledAt",
  "recoveryCodes",
  "updatedAt",
] as const;

export function securityToRow(row: SecurityRow): string[] {
  return [
    row.id,
    row.passwordHash,
    row.passwordChangedAt,
    row.totpSecret,
    row.totpEnabledAt,
    row.recoveryCodes.join(","),
    row.updatedAt,
  ];
}

export function rowToSecurity(row: string[]): SecurityRow {
  const g = (i: number): string => row[i] ?? "";
  return {
    id: g(0),
    passwordHash: g(1),
    passwordChangedAt: g(2),
    totpSecret: g(3),
    totpEnabledAt: g(4),
    recoveryCodes: g(5)
      .split(",")
      .map((code) => code.trim())
      .filter(Boolean),
    updatedAt: g(6),
  };
}

// ── UserAccess（管理者だけが書く）──────────────────────────────────────────────

export const USER_ACCESS_HEADERS = ["id", "status", "updatedAt"] as const;

export function accessToRow(row: AccessRow): string[] {
  return [row.id, row.status, row.updatedAt];
}

export function rowToAccess(row: string[]): AccessRow {
  const g = (i: number): string => row[i] ?? "";
  const status: UserStatus = g(1) === "disabled" ? "disabled" : "active";
  return { id: g(0), status, updatedAt: g(2) };
}

// ── SessionVersions（nextSeq だけで増やす版数）────────────────────────────────

export const SESSION_VERSIONS_HEADERS = ["key", "seq"] as const;

// ── AuthCounter ───────────────────────────────────────────────────────────────

export const AUTH_COUNTERS_HEADERS = ["key", "seq"] as const;

// ── Invite ────────────────────────────────────────────────────────────────────

export const INVITES_HEADERS = [
  "id",
  "kind",
  "tokenHash",
  "userId",
  "role",
  "note",
  "createdBy",
  "createdAt",
  "expiresAt",
  "usedAt",
] as const;

export function inviteToRow(invite: Invite): string[] {
  return [
    invite.id,
    invite.kind,
    invite.tokenHash,
    invite.userId,
    invite.role,
    invite.note,
    invite.createdBy,
    invite.createdAt,
    invite.expiresAt,
    invite.usedAt,
  ];
}

export function rowToInvite(row: string[]): Invite {
  const g = (i: number): string => row[i] ?? "";
  const kind: InviteKind = g(1) === "reset" ? "reset" : "invite";
  return {
    id: g(0),
    kind,
    tokenHash: g(2),
    userId: g(3),
    role: g(4) === "admin" ? "admin" : "user",
    note: g(5),
    createdBy: g(6),
    createdAt: g(7),
    expiresAt: g(8),
    usedAt: g(9),
  };
}

// ── AuditLog ──────────────────────────────────────────────────────────────────

export const AUDIT_LOG_HEADERS = [
  "id",
  "at",
  "actorType",
  "actorId",
  "actorName",
  "action",
  "targetType",
  "targetId",
  "summary",
  "ip",
] as const;

export function auditToRow(entry: AuditEntry): string[] {
  return [
    entry.id,
    entry.at,
    entry.actorType,
    entry.actorId,
    entry.actorName,
    entry.action,
    entry.targetType,
    entry.targetId,
    entry.summary,
    entry.ip,
  ];
}

export function rowToAudit(row: string[]): AuditEntry {
  const g = (i: number): string => row[i] ?? "";
  const actorType: AuditActorType =
    g(2) === "token" ? "token" : g(2) === "system" ? "system" : "user";
  return {
    id: g(0),
    at: g(1),
    actorType,
    actorId: g(3),
    actorName: g(4),
    action: g(5),
    targetType: g(6),
    targetId: g(7),
    summary: g(8),
    ip: g(9),
  };
}

// ── Expense ───────────────────────────────────────────────────────────────────

export const EXPENSES_HEADERS = [
  "id",
  "date",
  "merchant",
  "amount",
  "category",
  "source",
  "note",
  "createdAt",
  "updatedAt",
  "responsibility",
  "expectedDebitMonth",
  "settlementStatus",
  // 会社スコープ。既存シートの行は列が足りず空文字になるため、未設定として読める。
  "issuerId",
] as const;

export function expenseToRow(expense: Expense): string[] {
  return [
    expense.id,
    expense.date,
    expense.merchant,
    String(expense.amount),
    expense.category,
    expense.source,
    expense.note,
    expense.createdAt,
    expense.updatedAt,
    s(expense.responsibility),
    s(expense.expectedDebitMonth),
    s(expense.settlementStatus),
    s(expense.issuerId),
  ];
}

export function rowToExpense(row: string[]): Expense {
  const g = (i: number): string => row[i] ?? "";
  const cat = g(4);
  // 未知の費目は、雑費に流さず人が確かめる「要確認」にする。
  const category: ExpenseCategory = isExpenseCategory(cat) ? cat : "要確認";
  return {
    id: g(0),
    date: g(1),
    merchant: g(2),
    amount: Number(g(3)),
    category,
    source: g(5),
    note: g(6),
    createdAt: g(7),
    updatedAt: g(8),
    responsibility:
      g(9) === "other" ? "other" : g(9) === "self" ? "self" : undefined,
    expectedDebitMonth: /^\d{4}-\d{2}$/.test(g(10)) ? g(10) : undefined,
    settlementStatus:
      g(11) === "provisional"
        ? "provisional"
        : g(11) === "confirmed"
          ? "confirmed"
          : undefined,
    issuerId: opt(g(12)),
  };
}

// ── MerchantRule（自己学習辞書）─────────────────────────────────────────────────

export function merchantRuleToRow(rule: MerchantRule): string[] {
  return [rule.key, rule.sampleMerchant, rule.category, rule.updatedAt];
}

export function rowToMerchantRule(row: string[]): MerchantRule {
  const g = (i: number): string => row[i] ?? "";
  const cat = g(2);
  const category: ExpenseCategory = isExpenseCategory(cat) ? cat : "要確認";
  return {
    key: g(0),
    sampleMerchant: g(1),
    category,
    updatedAt: g(3),
  };
}

// ── BankTransaction（銀行明細）────────────────────────────────────────────────

export const BANK_TRANSACTIONS_HEADERS = [
  "id",
  "key",
  "date",
  "seq",
  "description",
  "amount",
  "balance",
  "account",
  "confidence",
  "method",
  "needsReview",
  "matchedDocumentId",
  "createdAt",
  "updatedAt",
] as const;

const CLASSIFY_METHODS: readonly ClassifyMethod[] = [
  "match",
  "rule",
  "jev",
  "manual",
  "fallback",
];

export function bankTransactionToRow(tx: BankTransaction): string[] {
  return [
    tx.id,
    tx.key,
    tx.date,
    String(tx.seq),
    tx.description,
    String(tx.amount),
    tx.balance === undefined ? "" : String(tx.balance),
    tx.account,
    String(tx.confidence),
    tx.method,
    tx.needsReview ? "TRUE" : "FALSE",
    s(tx.matchedDocumentId),
    tx.createdAt,
    tx.updatedAt,
  ];
}

export function rowToBankTransaction(row: string[]): BankTransaction {
  const g = (i: number): string => row[i] ?? "";
  const method = CLASSIFY_METHODS.find((m) => m === g(9)) ?? "fallback";
  return {
    id: g(0),
    key: g(1),
    date: g(2),
    seq: Number(g(3)) || 0,
    description: g(4),
    amount: Number(g(5)) || 0,
    balance: g(6) === "" ? undefined : Number(g(6)),
    account: g(7),
    confidence: Number(g(8)) || 0,
    method,
    needsReview: g(10) === "TRUE",
    matchedDocumentId: g(11) || undefined,
    createdAt: g(12),
    updatedAt: g(13),
  };
}

// ── Revenue（売上台帳）───────────────────────────────────────────────────────

export const REVENUES_HEADERS = [
  "id",
  "issuerId",
  "date",
  "partyId",
  "partyName",
  "amount",
  "description",
  "source",
  "documentId",
  "createdAt",
  "updatedAt",
] as const;

export function revenueToRow(revenue: Revenue): string[] {
  return [
    revenue.id,
    revenue.issuerId,
    revenue.date,
    s(revenue.partyId),
    revenue.partyName,
    String(revenue.amount),
    revenue.description,
    revenue.source,
    s(revenue.documentId),
    revenue.createdAt,
    revenue.updatedAt,
  ];
}

export function rowToRevenue(row: string[]): Revenue {
  const g = (i: number): string => row[i] ?? "";
  return {
    id: g(0),
    issuerId: g(1),
    date: g(2),
    partyId: opt(g(3)),
    partyName: g(4),
    amount: Number(g(5)),
    description: g(6),
    source: g(7),
    documentId: opt(g(8)),
    createdAt: g(9),
    updatedAt: g(10),
  };
}

// ── ApiToken ──────────────────────────────────────────────────────────────────

export const API_TOKENS_HEADERS = [
  "id",
  "name",
  "tokenHash",
  "createdAt",
] as const;

export function apiTokenToRow(token: ApiToken): string[] {
  return [token.id, token.name, token.tokenHash, token.createdAt];
}

export function rowToApiToken(row: string[]): ApiToken {
  const g = (i: number): string => row[i] ?? "";
  return { id: g(0), name: g(1), tokenHash: g(2), createdAt: g(3) };
}

/** アプリが使う表のタブと見出し。スプレッドシートに無いタブは、この見出しで作る。 */
export const TABLES: ReadonlyArray<{
  name: string;
  header: readonly string[];
}> = [
  { name: SHEET_NAMES.documents, header: DOCUMENTS_HEADERS },
  { name: SHEET_NAMES.parties, header: PARTIES_HEADERS },
  { name: SHEET_NAMES.issuers, header: ISSUERS_HEADERS },
  { name: SHEET_NAMES.expenses, header: EXPENSES_HEADERS },
  { name: SHEET_NAMES.revenues, header: REVENUES_HEADERS },
  { name: SHEET_NAMES.bankTransactions, header: BANK_TRANSACTIONS_HEADERS },
  { name: SHEET_NAMES.merchantRules, header: MERCHANT_RULES_HEADERS },
  { name: SHEET_NAMES.counters, header: COUNTERS_HEADERS },
  { name: SHEET_NAMES.settings, header: SETTINGS_HEADERS },
  { name: SHEET_NAMES.users, header: USERS_HEADERS },
  { name: SHEET_NAMES.apiTokens, header: API_TOKENS_HEADERS },
  { name: SHEET_NAMES.userProfiles, header: USER_PROFILES_HEADERS },
  { name: SHEET_NAMES.userSecurity, header: USER_SECURITY_HEADERS },
  { name: SHEET_NAMES.userAccess, header: USER_ACCESS_HEADERS },
  { name: SHEET_NAMES.authCounters, header: AUTH_COUNTERS_HEADERS },
  { name: SHEET_NAMES.sessionVersions, header: SESSION_VERSIONS_HEADERS },
  { name: SHEET_NAMES.invites, header: INVITES_HEADERS },
  { name: SHEET_NAMES.auditLog, header: AUDIT_LOG_HEADERS },
];
