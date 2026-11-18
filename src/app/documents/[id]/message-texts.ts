import { formatJpDate } from "@/lib/utils";

interface Deadline {
  dueDate?: string;
  validUntil?: string;
}

/** 支払期日があればそれを、無ければ有効期限を 1 行にする。 */
export function deadlineLine(doc: Deadline): string | null {
  if (doc.dueDate) return `支払期日：${formatJpDate(doc.dueDate)}`;
  if (doc.validUntil) return `有効期限：${formatJpDate(doc.validUntil)}`;
  return null;
}

function recipientLine(partyName?: string | null): string {
  return partyName ? `${partyName}\nご担当者様` : "ご担当者様";
}

interface MessageParams {
  typeLabel: string;
  issuerName?: string | null;
  partyName?: string | null;
  title: string;
  number: string;
  totalText: string;
  deadline?: string | null;
  filename: string;
}

/** 送付文（メール件名・メール本文・チャット本文）の文面を作る。 */
export function buildMessageTexts({
  typeLabel,
  issuerName,
  partyName,
  title,
  number,
  totalText,
  deadline,
  filename,
}: MessageParams): {
  emailSubject: string;
  emailBody: string;
  chatBody: string;
} {
  const deadlineText = deadline ? `\n${deadline}` : "";

  const emailSubject = `【${typeLabel}送付】${title}（${partyName ?? "ご確認"}）`;
  const emailBody = `${recipientLine(partyName)}

いつもお世話になっております。
${issuerName || ""}です。

${typeLabel}を添付にてお送りいたします。
ご確認のほど、よろしくお願いいたします。

件名：${title}
${typeLabel}番号：${number}
金額：${totalText}${deadlineText}
添付ファイル：${filename}

よろしくお願いいたします。`;

  const chatBody = `${typeLabel}をお送りします。

件名：${title}
${typeLabel}番号：${number}
金額：${totalText}${deadlineText}
添付ファイル：${filename}

ご確認よろしくお願いいたします。`;

  return { emailSubject, emailBody, chatBody };
}
