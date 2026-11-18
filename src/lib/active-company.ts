/**
 * 選択中の会社。複数の会社の帳簿を1つのアプリで分けて持つための切替の実体。
 *
 * 選択は Cookie に持つ。DB に持たせないのは、これが「今どちらを見ているか」という
 * 端末側の表示状態であって、会社のデータではないため。
 */
import { cookies } from "next/headers";
import type { Issuer } from "@/domain/issuer";
import type { CompanyScope, Repositories } from "@/repositories/types";

export const ACTIVE_COMPANY_COOKIE = "keiri_company";

/** Cookie の保持期間。切替は年に数回なので長めに持つ。 */
export const ACTIVE_COMPANY_MAX_AGE = 60 * 60 * 24 * 365;

export interface CompanyContext {
  /** 選択中の会社。会社が1社も登録されていなければ null。 */
  active: Issuer | null;
  /** 選択肢として出す会社の一覧。 */
  companies: Issuer[];
  /** 既定会社の id。会社未設定の既存データはここに属するものとして扱う。 */
  defaultId: string | null;
}

/**
 * 選択中の会社を解決する。
 * Cookie の値が消えた会社を指していても、既定会社へ落ちるだけで壊れない。
 */
export async function loadCompanyContext(
  repos: Repositories,
): Promise<CompanyContext> {
  const companies = await repos.issuers.list();
  if (companies.length === 0) {
    return { active: null, companies, defaultId: null };
  }

  const fallback = companies.find((c) => c.isDefault) ?? companies[0];
  const store = await cookies();
  const wanted = store.get(ACTIVE_COMPANY_COOKIE)?.value;
  const active = companies.find((c) => c.id === wanted) ?? fallback;

  return { active, companies, defaultId: fallback.id };
}

/**
 * リポジトリへ渡す会社スコープ。
 *
 * 既定会社を見ているときだけ、会社が未設定の既存データも含める。
 * 会社スコープを入れる前に登録した帳票・経費が、切替の導入で消えたように
 * 見えるのを防ぐための扱い。
 */
export function companyScope(ctx: CompanyContext): CompanyScope {
  if (!ctx.active) return {};
  return {
    issuerId: ctx.active.id,
    includeUnassigned: ctx.active.id === ctx.defaultId,
  };
}

/** 会社ごとに分けて持つ設定のキー。現金残高など。 */
export function companySettingKey(ctx: CompanyContext, key: string): string {
  if (!ctx.active) return key;
  return `${key}:${ctx.active.id}`;
}
