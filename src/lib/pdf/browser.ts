"use client";

/**
 * PDF をブラウザで作る。サーバー（Cloudflare Workers の無料枠は CPU 10ms/リクエスト）で
 * 描画すると上限を超えるため、描画はすべて利用者の端末で行う。
 * 重いライブラリはボタンを押したときに初めて読み込む。
 */
import type { DocumentRecord } from "@/domain/documents";
import type { Issuer } from "@/domain/issuer";
import type { Party } from "@/domain/party";

const FONT_FAMILY = "Noto Sans JP";
let fontsRegistered = false;

export async function renderDocumentPdfBlob(params: {
  doc: DocumentRecord;
  issuer: Issuer;
  party: Party;
}): Promise<Blob> {
  const [{ pdf, Font }, { createElement }, { DocumentPdf }] = await Promise.all(
    [import("@react-pdf/renderer"), import("react"), import("./DocumentPdf")],
  );

  if (!fontsRegistered) {
    // フォントは public/fonts の静的ファイル（同一オリジンから取得する）
    Font.register({
      family: FONT_FAMILY,
      fonts: [
        { src: "/fonts/NotoSansJP-400.woff", fontWeight: 400 },
        { src: "/fonts/NotoSansJP-700.woff", fontWeight: 700 },
      ],
    });
    Font.registerHyphenationCallback((word) => [word]);
    fontsRegistered = true;
  }

  // DocumentPdf は Document 要素を返す。ライブラリの props 型と合わせるためのキャスト。
  const element = createElement(DocumentPdf, params) as Parameters<
    typeof pdf
  >[0];
  return pdf(element).toBlob();
}

/** Blob を、指定のファイル名で保存させる。 */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
