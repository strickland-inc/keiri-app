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
import type { User, NewUserInput, UserRole } from "@/domain/user";
import type { Invite, NewInviteInput } from "@/domain/invite";
import type { AuditEntry, AuditFilter, NewAuditEntry } from "@/domain/audit";
import type {
  AccessPatch,
  ProfilePatch,
  SecurityPatch,
  VersionSide,
} from "./user-merge";
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

/**
 * ユーザー。5 つのタブを合成して返す。書き込みは書き手ごとに分かれている
 * （user-merge.ts の冒頭を参照）。どの書き込みも、ほかの書き手の行は書かない。
 */
export interface UserRepository {
  list(): Promise<User[]>;
  get(id: string): Promise<User | null>;
  /** 大文字小文字を区別せずに探す。 */
  findByLoginId(loginId: string): Promise<User | null>;
  /** users と user_profiles と user_security に行を作る。 */
  create(input: NewUserInput): Promise<User>;
  /** すべてのタブと、版数の行から消す。 */
  remove(id: string): Promise<void>;
  /** 表示名（Cookie だけで書ける）。user_profiles だけを書く。 */
  updateProfile(id: string, patch: ProfilePatch): Promise<User>;
  /**
   * パスワード・2段階認証（user_security）。パスワードの再入力、招待や再設定のリンク、接続コードのどれかを
   * 通した操作と、保留 Cookie を持つログインの途中の操作だけが呼ぶ。bumpSession で本人の側の版を上げる。
   */
  updateSecurity(id: string, patch: SecurityPatch): Promise<User>;
  /** 状態（user_access）。管理者だけ（と /recover）。bumpSession で管理者の側の版を上げる。 */
  updateAccess(id: string, patch: AccessPatch): Promise<User>;
  /** 役割。users の行だけを書き、user_access は書き直さない。bumpSession で管理者の側の版を上げる。 */
  updateRole(
    id: string,
    role: UserRole,
    options?: { bumpSession?: boolean },
  ): Promise<User>;
  /** 管理者による 2段階認証のリセット。user_security の例外の書き込みで、管理者の側の版を上げる。 */
  resetTotp(id: string): Promise<User>;
  /** 版数だけを上げる（「すべての端末からログアウト」など）。必ず増えるので、古い書き込みで戻せない。 */
  bumpSessionVersion(id: string, side: VersionSide): Promise<void>;
}

export interface InviteRepository {
  list(): Promise<Invite[]>;
  get(id: string): Promise<Invite | null>;
  findByTokenHash(tokenHash: string): Promise<Invite | null>;
  create(input: NewInviteInput): Promise<Invite>;
  markUsed(id: string, usedAt: string): Promise<void>;
  remove(id: string): Promise<void>;
}

export interface AuditRepository {
  append(entry: NewAuditEntry): Promise<void>;
  /** 新しい順。最大 500 件。 */
  list(filter?: AuditFilter): Promise<AuditEntry[]>;
}

/** 窓口の nextSeq だけで増やす回数と、一度きりの操作の印。 */
export interface AuthCounterRepository {
  /** 鍵ごとの今の値（無ければ 0）と、消してよい古い `fail:` の鍵。 */
  inspect(
    keys: string[],
    nowMs: number,
  ): Promise<{ values: number[]; stale: string[] }>;
  /** max(保存値, floor) + 1 を保存して返す。 */
  next(key: string, floor?: number): Promise<number>;
  /** 複数の鍵を 1 回の通信で増やす。 */
  nextMany(keys: string[]): Promise<number[]>;
  deleteMany(keys: string[]): Promise<void>;
  /** 鍵の先頭が一致する行を消す（/recover のロック解除）。 */
  deleteByPrefix(prefixes: string[]): Promise<void>;
  /** 古い窓の `fail:` の行を、最大 20 行まで消す。 */
  prune(nowMs: number): Promise<void>;
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
  invites: InviteRepository;
  audit: AuditRepository;
  authCounters: AuthCounterRepository;
  /** 現在のバックエンド種別（UIの表示用）。 */
  backend: "memory" | "sheets";
}
