import type { DocumentRecord, NewDocumentInput } from "@/domain/documents";
import type { Repositories } from "@/repositories/types";
import { hasDocumentTemplateConfig } from "@/lib/config";
import {
  checkDocumentTemplateAccess,
  createDocumentSpreadsheet,
} from "@/lib/sheets/documentTemplate";

/**
 * 書類を採番して保存する。Sheets に保存していて、帳票テンプレート
 * （DOCUMENT_TEMPLATE_SPREADSHEET_ID）も設定してあるときだけ、帳票シート（PDF 元）も作る。
 * それ以外の PDF はブラウザで組む（src/lib/pdf/browser.ts）。
 * 画面の作成フォームとエージェント用 API が同じ処理を使う。
 */
export async function createDocumentWithTemplate(
  repos: Repositories,
  input: NewDocumentInput,
): Promise<DocumentRecord> {
  if (repos.backend !== "sheets" || !hasDocumentTemplateConfig()) {
    return repos.documents.create(input);
  }

  const [party, issuer] = await Promise.all([
    repos.parties.get(input.partyId),
    repos.issuers.get(input.issuerId),
  ]);
  if (!party) throw new Error("取引先が見つかりません");
  if (!issuer) throw new Error("発行元が見つかりません");
  await checkDocumentTemplateAccess();

  const doc = await repos.documents.create(input);
  const template = await createDocumentSpreadsheet({ doc, party, issuer });
  return repos.documents.update(doc.id, template);
}
