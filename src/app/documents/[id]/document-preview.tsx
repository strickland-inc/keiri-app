import type { ReactNode } from "react";
import { DOCUMENT_TYPE_LABELS, type DocumentRecord } from "@/domain/documents";
import type { Issuer } from "@/domain/issuer";
import type { Party } from "@/domain/party";
import {
  formatYen,
  lineAmount,
  summarize,
  TAX_RATE_LABELS,
} from "@/domain/money";
import { formatJpDate } from "@/lib/utils";
import { Card } from "@/components/ui/card";

interface DocumentPreviewProps {
  doc: DocumentRecord;
  party: Party | null;
  issuer: Issuer | null;
}

/** 紙の書類に近い見た目のプレビュー。 */
export function DocumentPreview({ doc, party, issuer }: DocumentPreviewProps) {
  const summary = summarize(doc.items);

  return (
    <Card className="flex flex-col gap-8 p-6 sm:p-10">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-6">
        <div>
          <p className="text-sm text-ink-muted">
            {DOCUMENT_TYPE_LABELS[doc.type]}
          </p>
          <p className="mt-1 text-2xl font-semibold tracking-tight text-ink tabular">
            {doc.number}
          </p>
        </div>
        <dl className="grid grid-cols-[auto_auto] gap-x-4 gap-y-1 text-sm">
          <DateRow label="発行日" value={doc.issueDate} />
          {doc.dueDate && <DateRow label="支払期日" value={doc.dueDate} />}
          {doc.validUntil && (
            <DateRow label="有効期限" value={doc.validUntil} />
          )}
        </dl>
      </header>

      <div className="grid gap-8 sm:grid-cols-2">
        <Block label="宛先">
          {party ? <PartyLines party={party} /> : <Muted>（取引先不明）</Muted>}
        </Block>
        <Block label="発行元">
          {issuer ? (
            <IssuerLines issuer={issuer} />
          ) : (
            <Muted>（発行元不明）</Muted>
          )}
        </Block>
      </div>

      <Block label="件名">
        <p className="font-medium">{doc.title}</p>
      </Block>

      {doc.purpose && (
        <Block label="但し書き">
          <p>{doc.purpose}</p>
        </Block>
      )}

      <ItemsTable items={doc.items} />
      <Totals summary={summary} />

      {doc.paymentTerms && (
        <Block label="支払条件">
          <p>{doc.paymentTerms}</p>
        </Block>
      )}

      {doc.notes && (
        <Block label="備考">
          <p className="whitespace-pre-wrap">{doc.notes}</p>
        </Block>
      )}

      {issuer?.bankInfo && (
        <div className="rounded-[var(--radius)] bg-canvas px-4 py-3.5">
          <Block label="振込先">
            <p className="whitespace-pre-wrap">{issuer.bankInfo}</p>
          </Block>
        </div>
      )}
    </Card>
  );
}

function DateRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-ink-muted">{label}</dt>
      <dd className="text-right text-ink tabular">{formatJpDate(value)}</dd>
    </>
  );
}

function Block({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium text-ink-muted">{label}</p>
      <div className="text-sm leading-relaxed text-ink">{children}</div>
    </div>
  );
}

function Muted({ children }: { children: ReactNode }) {
  return <p className="text-ink-muted">{children}</p>;
}

function PartyLines({ party }: { party: Party }) {
  return (
    <>
      <p className="font-semibold">{party.name}</p>
      {party.contactName && (
        <p>
          {party.contactName} {party.honorific ?? "様"}
        </p>
      )}
      {party.postalCode && <p>〒{party.postalCode}</p>}
      {party.address && <p>{party.address}</p>}
    </>
  );
}

function IssuerLines({ issuer }: { issuer: Issuer }) {
  return (
    <>
      <p className="font-semibold">{issuer.name}</p>
      {issuer.signatoryName && <p>{issuer.signatoryName}</p>}
      {issuer.postalCode && <p>〒{issuer.postalCode}</p>}
      {issuer.address && <p>{issuer.address}</p>}
      {issuer.building && <p>{issuer.building}</p>}
      {issuer.phone && <p>TEL: {issuer.phone}</p>}
      {issuer.email && <p>{issuer.email}</p>}
      {issuer.registrationNumber && (
        <p className="text-ink-muted">登録番号: {issuer.registrationNumber}</p>
      )}
    </>
  );
}

function ItemsTable({ items }: { items: DocumentRecord["items"] }) {
  const headClass = "py-2.5 pr-4 font-medium last:pr-0";
  const cellClass = "py-3 pr-4 last:pr-0";
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] text-sm">
        <thead>
          <tr className="border-y border-line-strong text-left text-xs text-ink-muted">
            <th className={headClass}>品名・内容</th>
            <th className={`${headClass} text-right`}>数量</th>
            <th className={headClass}>単位</th>
            <th className={`${headClass} text-right`}>単価</th>
            <th className={headClass}>税率</th>
            <th className={`${headClass} text-right`}>金額</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {items.map((item, i) => (
            <tr key={i}>
              <td className={cellClass}>{item.name}</td>
              <td className={`${cellClass} text-right tabular`}>
                {item.quantity}
              </td>
              <td className={`${cellClass} text-ink-muted`}>
                {item.unit ?? ""}
              </td>
              <td className={`${cellClass} text-right tabular`}>
                {formatYen(item.unitPrice)}
              </td>
              <td className={`${cellClass} text-ink-muted`}>
                {TAX_RATE_LABELS[String(item.taxRate)]}
              </td>
              <td className={`${cellClass} text-right tabular`}>
                {formatYen(lineAmount(item))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Totals({ summary }: { summary: ReturnType<typeof summarize> }) {
  return (
    <dl className="ml-auto flex w-full max-w-xs flex-col gap-1.5 text-sm">
      <TotalRow label="小計" value={formatYen(summary.subtotal)} />
      {summary.taxLines.map((line) => (
        <TotalRow
          key={line.rate}
          label={`消費税（${TAX_RATE_LABELS[String(line.rate)]}）`}
          value={formatYen(line.taxAmount)}
        />
      ))}
      <div className="mt-1 flex items-baseline justify-between gap-6 border-t border-line-strong pt-3 font-semibold text-ink">
        <dt>合計（税込）</dt>
        <dd className="text-xl tabular">{formatYen(summary.total)}</dd>
      </div>
    </dl>
  );
}

function TotalRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-6 text-ink-muted">
      <dt>{label}</dt>
      <dd className="tabular">{value}</dd>
    </div>
  );
}
