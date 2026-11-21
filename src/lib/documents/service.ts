/**
 * 書類の作成・更新・削除と PDF。画面のフォームと API が同じ処理を使う。
 *
 * スプレッドシートに保存しているときは、書類ごとに帳票のタブを作り、PDF はそのタブから書き出す。
 * 帳票のタブは書類の内容を写したものなので、内容を変えたら作り直し、書類を消したら一緒に消す。
 * デモ（保存先なし）のときは、書類のデータだけを扱う。
 */
import type { DocumentRecord, NewDocumentInput } from "@/domain/documents";
import type { Issuer } from "@/domain/issuer";
import type { Party } from "@/domain/party";
import type { Repositories } from "@/repositories/types";
import { GatewayError } from "@/lib/gateway";
import {
  deleteDocumentWithSheet,
  exportSheetPdf,
  saveDocumentWithSheet,
} from "./render";

async function loadParties(
  repos: Repositories,
  doc: Pick<DocumentRecord, "partyId" | "issuerId">,
): Promise<{ party: Party; issuer: Issuer }> {
  const [party, issuer] = await Promise.all([
    repos.parties.get(doc.partyId),
    repos.issuers.get(doc.issuerId),
  ]);
  if (!party) throw new Error("取引先が見つかりません");
  if (!issuer) throw new Error("発行元が見つかりません");
  return { party, issuer };
}

export async function createDocument(
  repos: Repositories,
  input: NewDocumentInput,
): Promise<DocumentRecord> {
  // 取引先と発行元を先に確かめる。番号を採ったあとで失敗すると、その番号が欠番になるため。
  // 発行済みの最大の番号も同じ通信で読んでおき、窓口への通信を 3 回（読む、採番、保存）に抑える。
  const [{ party, issuer }, floor] = await Promise.all([
    loadParties(repos, input),
    repos.documents.maxSeq(input.issuerId, input.type),
  ]);
  if (repos.backend !== "sheets") return repos.documents.create(input);
  const doc = await repos.documents.draft(input, floor);
  return saveDocumentWithSheet({ doc, party, issuer });
}

/** 書類の内容を変える。帳票のタブも、新しい内容で作り直す。 */
export async function updateDocument(
  repos: Repositories,
  id: string,
  patch: Partial<DocumentRecord>,
): Promise<DocumentRecord> {
  if (repos.backend !== "sheets") return repos.documents.update(id, patch);
  const existing = await repos.documents.get(id);
  if (!existing) throw new Error(`帳票が見つかりません: ${id}`);
  const doc: DocumentRecord = {
    ...existing,
    ...patch,
    id,
    updatedAt: new Date().toISOString(),
  };
  return saveDocumentWithSheet({ doc, ...(await loadParties(repos, doc)) });
}

export async function removeDocument(
  repos: Repositories,
  id: string,
): Promise<void> {
  if (repos.backend !== "sheets") return repos.documents.remove(id);
  const doc = await repos.documents.get(id);
  if (doc) await deleteDocumentWithSheet(doc);
}

/**
 * 書類の PDF を、帳票のタブから書き出す。
 * タブがまだ無い書類（以前の版で作ったもの）と、タブが消されていた書類は、先にタブを作る。
 */
export async function exportDocumentPdf(
  repos: Repositories,
  doc: DocumentRecord,
): Promise<Uint8Array> {
  if (repos.backend !== "sheets") {
    throw new Error("デモでは PDF を作れません");
  }
  const rebuild = async (): Promise<DocumentRecord> =>
    saveDocumentWithSheet({ doc, ...(await loadParties(repos, doc)) });
  if (!doc.generatedSheetId)
    return exportSheetPdf((await rebuild()).generatedSheetId!);
  try {
    return await exportSheetPdf(doc.generatedSheetId);
  } catch (error) {
    // タブが手で消されていたときは、書類の内容から作り直して書き出す。
    if (!(error instanceof GatewayError) || error.code !== "not_found")
      throw error;
    return exportSheetPdf((await rebuild()).generatedSheetId!);
  }
}
