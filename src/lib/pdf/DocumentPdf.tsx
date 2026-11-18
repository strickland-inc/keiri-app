import React from "react";
import { Document, Page, View, Text, StyleSheet } from "@react-pdf/renderer";
import type { DocumentRecord, DocumentType } from "@/domain/documents";
import { DOCUMENT_TYPE_LABELS } from "@/domain/documents";
import type { Issuer } from "@/domain/issuer";
import type { Party } from "@/domain/party";
import {
  summarize,
  formatYen,
  lineAmount,
  TAX_RATE_LABELS,
  type AmountSummary,
} from "@/domain/money";

export interface DocumentPdfProps {
  doc: DocumentRecord;
  issuer: Issuer;
  party: Party;
}

const BLUE = "#2864F0";
const BLUE_BG = "#EEF3FE";
const BODY = "#1C1C1C";
const MUTED = "#6B7280";
const BORDER = "#E5E7EB";
const TH_BG = "#F3F4F6";

const s = StyleSheet.create({
  page: {
    fontFamily: "Noto Sans JP",
    fontSize: 9,
    color: BODY,
    paddingTop: 36,
    paddingBottom: 48,
    paddingLeft: 40,
    paddingRight: 40,
    lineHeight: 1.5,
  },
  title: {
    fontSize: 20,
    fontWeight: 700,
    textAlign: "center",
    marginBottom: 20,
    letterSpacing: 6,
  },
  // ---- ヘッダー（左に宛先、右に発行元） ----
  headerRow: {
    flexDirection: "row",
    marginBottom: 14,
  },
  partyBlock: {
    flex: 6,
    paddingRight: 16,
  },
  issuerBlock: {
    flex: 5,
    alignItems: "flex-end",
  },
  partyPostal: {
    fontSize: 8.5,
    color: MUTED,
  },
  partyAddress: {
    fontSize: 8.5,
    marginBottom: 4,
  },
  partyNameRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 4,
    marginBottom: 2,
  },
  partyName: {
    fontSize: 13,
    fontWeight: 700,
  },
  partyHonorific: {
    fontSize: 10,
    fontWeight: 700,
    paddingBottom: 1,
  },
  partyContact: {
    fontSize: 8.5,
    color: MUTED,
  },
  issuerName: {
    fontSize: 11,
    fontWeight: 700,
    marginBottom: 3,
  },
  issuerDetail: {
    fontSize: 8,
    color: MUTED,
    textAlign: "right",
  },
  issuerRegNum: {
    fontSize: 7.5,
    color: MUTED,
    textAlign: "right",
    marginTop: 2,
    marginBottom: 6,
  },
  metaRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 6,
    marginBottom: 1,
  },
  metaLabel: {
    fontSize: 8,
    color: MUTED,
    width: 52,
    textAlign: "right",
  },
  metaValue: {
    fontSize: 8,
    textAlign: "right",
    minWidth: 90,
  },
  divider: {
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    borderBottomStyle: "solid",
    marginBottom: 10,
  },
  subjectRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
  },
  subjectLabel: {
    fontSize: 8,
    color: MUTED,
    marginRight: 8,
    width: 22,
  },
  subjectValue: {
    fontSize: 10,
    fontWeight: 700,
    flex: 1,
  },
  // ---- 金額の強調枠 ----
  amountBox: {
    borderLeftWidth: 4,
    borderLeftColor: BLUE,
    borderLeftStyle: "solid",
    backgroundColor: BLUE_BG,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginBottom: 14,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  amountBoxLabel: {
    fontSize: 10,
    fontWeight: 700,
    color: BLUE,
  },
  amountBoxRight: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 4,
  },
  amountBoxValue: {
    fontSize: 18,
    fontWeight: 700,
    color: BLUE,
  },
  amountBoxNote: {
    fontSize: 8,
    color: MUTED,
    paddingBottom: 2,
  },
  // ---- 領収書の但し書き ----
  receiptStatement: {
    fontSize: 11,
    fontWeight: 700,
    textAlign: "center",
    marginBottom: 6,
  },
  receiptPurpose: {
    fontSize: 9,
    textAlign: "center",
    color: MUTED,
    marginBottom: 14,
  },
  // ---- 種別ごとの補足 ----
  infoRow: {
    flexDirection: "row",
    gap: 24,
    marginBottom: 12,
  },
  infoItem: {
    flexDirection: "row",
    gap: 6,
    alignItems: "center",
  },
  infoLabel: {
    fontSize: 8,
    color: MUTED,
  },
  infoValue: {
    fontSize: 9,
  },
  // ---- 明細表 ----
  table: {
    borderWidth: 1,
    borderColor: BORDER,
    borderStyle: "solid",
    marginBottom: 8,
  },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    borderBottomStyle: "solid",
  },
  tableRowLast: {
    borderBottomWidth: 0,
  },
  thCell: {
    backgroundColor: TH_BG,
    paddingTop: 5,
    paddingBottom: 5,
    paddingLeft: 6,
    paddingRight: 6,
    fontWeight: 700,
    fontSize: 8,
    color: MUTED,
  },
  tdCell: {
    paddingTop: 4,
    paddingBottom: 4,
    paddingLeft: 6,
    paddingRight: 6,
    minHeight: 20,
  },
  borderRight: {
    borderRightWidth: 1,
    borderRightColor: BORDER,
    borderRightStyle: "solid",
  },
  colName: {
    flex: 1,
  },
  colQty: {
    width: 58,
    textAlign: "center",
  },
  colUnitPrice: {
    width: 100,
    textAlign: "right",
  },
  colAmount: {
    width: 100,
    textAlign: "right",
  },
  // ---- 集計 ----
  summarySection: {
    alignItems: "flex-end",
    marginBottom: 14,
  },
  summaryTable: {
    width: 230,
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 3,
    paddingHorizontal: 6,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    borderBottomStyle: "solid",
  },
  summaryLabel: {
    fontSize: 8.5,
    color: MUTED,
  },
  summaryValue: {
    fontSize: 8.5,
  },
  summaryTotalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 5,
    paddingHorizontal: 6,
    borderTopWidth: 2,
    borderTopColor: BLUE,
    borderTopStyle: "solid",
    marginTop: 1,
  },
  summaryTotalLabel: {
    fontSize: 10,
    fontWeight: 700,
    color: BLUE,
  },
  summaryTotalValue: {
    fontSize: 11,
    fontWeight: 700,
    color: BLUE,
  },
  // ---- 備考 ----
  notesSection: {
    marginBottom: 12,
    padding: 8,
    backgroundColor: TH_BG,
    borderRadius: 3,
  },
  notesSectionLabel: {
    fontSize: 7.5,
    color: MUTED,
    fontWeight: 700,
    marginBottom: 3,
  },
  notesText: {
    fontSize: 8.5,
    lineHeight: 1.6,
  },
  // ---- 振込先 ----
  bankSection: {
    marginBottom: 12,
    padding: 8,
    borderWidth: 1,
    borderColor: BORDER,
    borderStyle: "solid",
    borderRadius: 3,
  },
  bankSectionLabel: {
    fontSize: 7.5,
    color: BLUE,
    fontWeight: 700,
    marginBottom: 4,
  },
  bankText: {
    fontSize: 8.5,
    lineHeight: 1.7,
  },
  // ---- 収入印紙の枠（領収書） ----
  stampRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginBottom: 10,
  },
  stampBox: {
    width: 76,
    height: 68,
    borderWidth: 1,
    borderColor: BORDER,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
  },
  stampLabel: {
    fontSize: 7.5,
    color: MUTED,
  },
  // ---- 末尾の発行元（領収書） ----
  receiptIssuerBlock: {
    marginTop: 10,
    alignItems: "flex-end",
  },
  receiptIssuerName: {
    fontSize: 11,
    fontWeight: 700,
    marginBottom: 2,
  },
  receiptIssuerDetail: {
    fontSize: 8,
    color: MUTED,
    textAlign: "right",
  },
  receiptIssuerRegNum: {
    fontSize: 7.5,
    color: MUTED,
    textAlign: "right",
    marginTop: 3,
  },
});

const AMOUNT_BOX_LABELS: Record<DocumentType, string> = {
  invoice: "ご請求金額",
  quote: "お見積金額",
  delivery_note: "合計金額",
  purchase_order: "合計金額",
  receipt: "領収金額",
};

function formatDate(iso: string): string {
  const parts = iso.split("-");
  if (parts.length !== 3) return iso;
  const [y, m, d] = parts;
  return `${y}年${m}月${d}日`;
}

function formatPostal(code: string | undefined): string {
  if (!code) return "";
  const clean = code.replace(/[^0-9]/g, "");
  if (clean.length === 7) {
    return `〒${clean.slice(0, 3)}-${clean.slice(3)}`;
  }
  return `〒${code}`;
}

/** 明細表の最低行数。足りない分は空行で埋め、行数の違う帳票でも表の高さを揃える。 */
const MIN_ROWS = 10;

function PartyBlock({ party }: { party: Party }): React.ReactElement {
  return (
    <View style={s.partyBlock}>
      {party.postalCode && (
        <Text style={s.partyPostal}>{formatPostal(party.postalCode)}</Text>
      )}
      {party.address && <Text style={s.partyAddress}>{party.address}</Text>}
      <View style={s.partyNameRow}>
        <Text style={s.partyName}>{party.name}</Text>
        {party.honorific && (
          <Text style={s.partyHonorific}>{party.honorific}</Text>
        )}
      </View>
      {party.contactName && (
        <Text style={s.partyContact}>
          {party.contactName}
          {party.honorific === "様" ? "" : " 様"}
        </Text>
      )}
    </View>
  );
}

function MetaRow({
  label,
  value,
}: {
  label: string;
  value: string;
}): React.ReactElement {
  return (
    <View style={s.metaRow}>
      <Text style={s.metaLabel}>{label}</Text>
      <Text style={s.metaValue}>{value}</Text>
    </View>
  );
}

/** 発行元の住所・連絡先と、番号・発行日などの帳票情報。 */
function IssuerBlock({
  doc,
  issuer,
}: {
  doc: DocumentRecord;
  issuer: Issuer;
}): React.ReactElement {
  return (
    <View style={s.issuerBlock}>
      <Text style={s.issuerName}>{issuer.name}</Text>
      {issuer.signatoryName && (
        <Text style={s.issuerDetail}>{issuer.signatoryName}</Text>
      )}
      {issuer.postalCode && (
        <Text style={s.issuerDetail}>{formatPostal(issuer.postalCode)}</Text>
      )}
      {issuer.address && <Text style={s.issuerDetail}>{issuer.address}</Text>}
      {issuer.building && <Text style={s.issuerDetail}>{issuer.building}</Text>}
      {issuer.phone && <Text style={s.issuerDetail}>TEL: {issuer.phone}</Text>}
      {issuer.email && <Text style={s.issuerDetail}>{issuer.email}</Text>}
      {issuer.registrationNumber && (
        <Text style={s.issuerRegNum}>
          登録番号: {issuer.registrationNumber}
        </Text>
      )}

      <MetaRow label="番号" value={doc.number} />
      <MetaRow label="発行日" value={formatDate(doc.issueDate)} />
      {doc.type === "invoice" && doc.dueDate && (
        <MetaRow label="支払期日" value={formatDate(doc.dueDate)} />
      )}
      {doc.type === "quote" && doc.validUntil && (
        <MetaRow label="有効期限" value={formatDate(doc.validUntil)} />
      )}
    </View>
  );
}

function AmountBox({
  label,
  total,
}: {
  label: string;
  total: number;
}): React.ReactElement {
  return (
    <View style={s.amountBox}>
      <Text style={s.amountBoxLabel}>{label}</Text>
      <View style={s.amountBoxRight}>
        <Text style={s.amountBoxValue}>{formatYen(total)}</Text>
        <Text style={s.amountBoxNote}>(税込)</Text>
      </View>
    </View>
  );
}

/** 明細表の1行。最終行だけ下罫線を消す（表の外枠と重ねないため）。 */
function ItemRow({
  cells,
  isLast,
}: {
  cells: readonly [string, string, string, string];
  isLast: boolean;
}): React.ReactElement {
  const [name, quantity, unitPrice, amount] = cells;
  return (
    <View style={isLast ? [s.tableRow, s.tableRowLast] : s.tableRow}>
      <View style={[s.tdCell, s.colName, s.borderRight]}>
        <Text>{name}</Text>
      </View>
      <View style={[s.tdCell, s.colQty, s.borderRight]}>
        <Text>{quantity}</Text>
      </View>
      <View style={[s.tdCell, s.colUnitPrice, s.borderRight]}>
        <Text>{unitPrice}</Text>
      </View>
      <View style={[s.tdCell, s.colAmount]}>
        <Text>{amount}</Text>
      </View>
    </View>
  );
}

function ItemsTable({ doc }: { doc: DocumentRecord }): React.ReactElement {
  const emptyRowCount = Math.max(0, MIN_ROWS - doc.items.length);

  return (
    <View style={s.table}>
      <View style={s.tableRow}>
        <View style={[s.thCell, s.colName, s.borderRight]}>
          <Text>品名</Text>
        </View>
        <View style={[s.thCell, s.colQty, s.borderRight]}>
          <Text>数量</Text>
        </View>
        <View style={[s.thCell, s.colUnitPrice, s.borderRight]}>
          <Text>単価</Text>
        </View>
        <View style={[s.thCell, s.colAmount]}>
          <Text>金額</Text>
        </View>
      </View>

      {doc.items.map((item, idx) => (
        <ItemRow
          key={idx}
          cells={[
            item.name,
            `${item.quantity}${item.unit ?? ""}`,
            formatYen(item.unitPrice),
            formatYen(lineAmount(item)),
          ]}
          isLast={idx === doc.items.length - 1 && emptyRowCount === 0}
        />
      ))}

      {Array.from({ length: emptyRowCount }, (_, idx) => (
        <ItemRow
          key={`empty-${idx}`}
          cells={[" ", " ", " ", " "]}
          isLast={idx === emptyRowCount - 1}
        />
      ))}
    </View>
  );
}

function SummaryTable({
  summary,
}: {
  summary: AmountSummary;
}): React.ReactElement {
  return (
    <View style={s.summarySection}>
      <View style={s.summaryTable}>
        <View style={s.summaryRow}>
          <Text style={s.summaryLabel}>小計</Text>
          <Text style={s.summaryValue}>{formatYen(summary.subtotal)}</Text>
        </View>
        {summary.taxLines.map((tl, idx) => (
          <View key={idx} style={s.summaryRow}>
            <Text style={s.summaryLabel}>
              消費税（
              {TAX_RATE_LABELS[String(tl.rate)] ?? `${String(tl.rate)}%`}）
            </Text>
            <Text style={s.summaryValue}>{formatYen(tl.taxAmount)}</Text>
          </View>
        ))}
        <View style={s.summaryTotalRow}>
          <Text style={s.summaryTotalLabel}>合計</Text>
          <Text style={s.summaryTotalValue}>{formatYen(summary.total)}</Text>
        </View>
      </View>
    </View>
  );
}

/** インボイス制度の記載事項である、税率ごとの対象額。 */
function TaxableBreakdown({
  taxLines,
}: {
  taxLines: AmountSummary["taxLines"];
}): React.ReactElement {
  return (
    <View style={s.summarySection}>
      <View style={s.summaryTable}>
        {taxLines.map((tl, idx) => (
          <View key={idx} style={s.summaryRow}>
            <Text style={s.summaryLabel}>
              {TAX_RATE_LABELS[String(tl.rate)] ?? String(tl.rate)} 対象額
            </Text>
            <Text style={s.summaryValue}>{formatYen(tl.taxableAmount)}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/** 領収書の末尾に、発行元をもう一度書く。 */
function ReceiptIssuerBlock({
  issuer,
}: {
  issuer: Issuer;
}): React.ReactElement {
  return (
    <View style={s.receiptIssuerBlock}>
      <Text style={s.receiptIssuerName}>{issuer.name}</Text>
      {issuer.signatoryName && (
        <Text style={s.receiptIssuerDetail}>{issuer.signatoryName}</Text>
      )}
      {issuer.address && (
        <Text style={s.receiptIssuerDetail}>{issuer.address}</Text>
      )}
      {issuer.phone && (
        <Text style={s.receiptIssuerDetail}>TEL: {issuer.phone}</Text>
      )}
      {issuer.registrationNumber && (
        <Text style={s.receiptIssuerRegNum}>
          登録番号: {issuer.registrationNumber}
        </Text>
      )}
    </View>
  );
}

export function DocumentPdf({
  doc,
  issuer,
  party,
}: DocumentPdfProps): React.ReactElement {
  const summary = summarize(doc.items);
  const isReceipt = doc.type === "receipt";

  return (
    <Document>
      <Page size="A4" style={s.page}>
        <Text style={s.title}>{DOCUMENT_TYPE_LABELS[doc.type]}</Text>

        <View style={s.headerRow}>
          <PartyBlock party={party} />
          <IssuerBlock doc={doc} issuer={issuer} />
        </View>

        <View style={s.divider} />

        <View style={s.subjectRow}>
          <Text style={s.subjectLabel}>件名</Text>
          <Text style={s.subjectValue}>{doc.title}</Text>
        </View>

        <AmountBox label={AMOUNT_BOX_LABELS[doc.type]} total={summary.total} />

        {isReceipt && (
          <>
            <Text style={s.receiptStatement}>上記正に領収いたしました</Text>
            {doc.purpose && (
              <Text style={s.receiptPurpose}>但し、{doc.purpose}として</Text>
            )}
          </>
        )}

        {doc.type === "quote" && doc.paymentTerms && (
          <View style={s.infoRow}>
            <View style={s.infoItem}>
              <Text style={s.infoLabel}>支払条件</Text>
              <Text style={s.infoValue}>{doc.paymentTerms}</Text>
            </View>
          </View>
        )}

        <ItemsTable doc={doc} />

        <SummaryTable summary={summary} />
        {summary.taxLines.length > 0 && (
          <TaxableBreakdown taxLines={summary.taxLines} />
        )}

        {doc.notes && (
          <View style={s.notesSection}>
            <Text style={s.notesSectionLabel}>備考</Text>
            <Text style={s.notesText}>{doc.notes}</Text>
          </View>
        )}

        {doc.type === "invoice" && issuer.bankInfo && (
          <View style={s.bankSection}>
            <Text style={s.bankSectionLabel}>振込先</Text>
            <Text style={s.bankText}>{issuer.bankInfo}</Text>
          </View>
        )}

        {isReceipt && (
          <>
            <View style={s.stampRow}>
              <View style={s.stampBox}>
                <Text style={s.stampLabel}>収入印紙</Text>
              </View>
            </View>
            <ReceiptIssuerBlock issuer={issuer} />
          </>
        )}
      </Page>
    </Document>
  );
}
