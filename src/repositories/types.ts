/**
 * 永続化の抽象（Repository インターフェース）。
 * UI/APIはこの型だけに依存し、実体（InMemory / Google Sheets / 将来のDB）は
 * factory（./index.ts）が環境に応じて注入する。これが「商用化時にDBへ差し替え」の境界。
 */
import type { ApiToken, NewApiTokenInput } from "@/domain/api-token";
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

/**
 * 会社スコープの指定。
 * `issuerId` を渡すとその会社のレコードだけを返す。
 * `includeUnassigned` は、会社が未設定の既存データ（会社導入前に作られたもの）を
 * 併せて含めるかどうか。呼び出し側は「既定会社を見ているとき」だけ true にする。
 */
export interface CompanyScope {
  issuerId?: string;
  includeUnassigned?: boolean;
}

export interface DocumentFilter extends CompanyScope {
  type?: DocumentType;
  partyId?: string;
  status?: string;
}

export interface DocumentRepository {
  list(filter?: DocumentFilter): Promise<DocumentRecord[]>;
  get(id: string): Promise<DocumentRecord | null>;
  /** 採番して作成する（採番は会社ごと・帳票種別ごとの通し連番）。 */
  create(input: NewDocumentInput): Promise<DocumentRecord>;
  /** その会社・種別で発行済みの、最大の連番。1 件も無ければ 0。 */
  maxSeq(issuerId: string, type: DocumentType): Promise<number>;
  /**
   * 採番まで済ませた書類を、保存せずに返す。帳票のタブと一緒に保存するときに使う。
   * floor には maxSeq の値を渡す（カウンターが遅れていても、発行済みの番号と重ならないようにする）。
   */
  draft(input: NewDocumentInput, floor: number): Promise<DocumentRecord>;
  update(id: string, patch: Partial<DocumentRecord>): Promise<DocumentRecord>;
  remove(id: string): Promise<void>;
}

export interface PartyRepository {
  list(): Promise<Party[]>;
  get(id: string): Promise<Party | null>;
  create(input: NewPartyInput): Promise<Party>;
  update(id: string, patch: Partial<Party>): Promise<Party>;
  remove(id: string): Promise<void>;
}

export interface IssuerRepository {
  list(): Promise<Issuer[]>;
  get(id: string): Promise<Issuer | null>;
  getDefault(): Promise<Issuer | null>;
  create(input: NewIssuerInput): Promise<Issuer>;
  update(id: string, patch: Partial<Issuer>): Promise<Issuer>;
  remove(id: string): Promise<void>;
}

export interface UserRepository {
  list(): Promise<User[]>;
  get(id: string): Promise<User | null>;
  findByLoginId(loginId: string): Promise<User | null>;
  create(input: NewUserInput): Promise<User>;
  remove(id: string): Promise<void>;
}

export interface ExpenseFilter extends CompanyScope {
  month?: string;
  category?: string;
}

export interface ExpenseRepository {
  list(filter?: ExpenseFilter): Promise<Expense[]>;
  get(id: string): Promise<Expense | null>;
  create(input: NewExpenseInput): Promise<Expense>;
  bulkCreate(inputs: NewExpenseInput[]): Promise<Expense[]>;
  update(id: string, patch: Partial<Expense>): Promise<Expense>;
  remove(id: string): Promise<void>;
}

export interface SettingsRepository {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  all(): Promise<Record<string, string>>;
}

export interface MerchantRuleRepository {
  all(): Promise<MerchantRule[]>;
  get(key: string): Promise<MerchantRule | null>;
  upsert(input: NewMerchantRule): Promise<MerchantRule>;
}

export interface BankTransactionRepository {
  /** 日付の新しい順。 */
  list(): Promise<BankTransaction[]>;
  get(id: string): Promise<BankTransaction | null>;
  bulkCreate(inputs: NewBankTransactionInput[]): Promise<BankTransaction[]>;
  update(id: string, patch: Partial<BankTransaction>): Promise<BankTransaction>;
  remove(id: string): Promise<void>;
}

export interface RevenueFilter extends CompanyScope {
  from?: string;
  to?: string;
}

export interface RevenueRepository {
  list(filter?: RevenueFilter): Promise<Revenue[]>;
  get(id: string): Promise<Revenue | null>;
  create(input: NewRevenueInput): Promise<Revenue>;
  bulkCreate(inputs: NewRevenueInput[]): Promise<Revenue[]>;
  update(id: string, patch: Partial<Revenue>): Promise<Revenue>;
  remove(id: string): Promise<void>;
}

export interface ApiTokenRepository {
  list(): Promise<ApiToken[]>;
  create(input: NewApiTokenInput): Promise<ApiToken>;
  remove(id: string): Promise<void>;
}

export interface Repositories {
  documents: DocumentRepository;
  parties: PartyRepository;
  issuers: IssuerRepository;
  users: UserRepository;
  expenses: ExpenseRepository;
  settings: SettingsRepository;
  merchantRules: MerchantRuleRepository;
  bankTransactions: BankTransactionRepository;
  revenues: RevenueRepository;
  apiTokens: ApiTokenRepository;
  /** 現在のバックエンド種別（UIの表示用）。 */
  backend: "memory" | "sheets";
}
