"use server";

import { revalidatePath } from "next/cache";
import { getRepositories } from "@/repositories";
import { RECEIVABLE, accountsFor } from "@/domain/bank";

function refresh(): void {
  revalidatePath("/bank");
  revalidatePath("/accounting", "layout");
}

/** 利用者が科目を直す。以後、同じ摘要の取引にはこの科目が再利用される。 */
export async function changeBankAccount(
  id: string,
  account: string,
): Promise<void> {
  const repos = await getRepositories();
  const tx = await repos.bankTransactions.get(id);
  if (!tx) throw new Error("明細が見つかりません");

  const allowed = accountsFor(tx.amount).filter(
    (a) => a !== RECEIVABLE || tx.matchedDocumentId !== undefined,
  );
  if (!allowed.includes(account))
    throw new Error("この取引には選べない勘定科目です");

  await repos.bankTransactions.update(id, {
    account,
    method: "manual",
    confidence: 1,
    needsReview: false,
    // 売掛金以外へ直したら、請求書との照合は外す（請求書の状態はそのまま）
    matchedDocumentId:
      account === RECEIVABLE ? tx.matchedDocumentId : undefined,
  });
  refresh();
}

/** 判断が正しいことを確認した。 */
export async function confirmBankTransaction(id: string): Promise<void> {
  const repos = await getRepositories();
  await repos.bankTransactions.update(id, {
    needsReview: false,
    method: "manual",
    confidence: 1,
  });
  refresh();
}

export async function removeBankTransaction(id: string): Promise<void> {
  const repos = await getRepositories();
  await repos.bankTransactions.remove(id);
  refresh();
}
