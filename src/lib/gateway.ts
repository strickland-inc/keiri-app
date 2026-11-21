/**
 * スプレッドシート側の窓口（apps-script/Code.gs）への接続。
 * スプレッドシートへの読み書きは、すべてここを通る。接続先と鍵は接続コード（KEIRI_CONNECTION）に入っている。
 */

export interface Connection {
  url: string;
  key: string;
  spreadsheetId: string;
}

const CODE_PREFIX = "keiri1_";
const WEB_APP_URL = /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/;

/** 帳票のタブを組み立てる手順。窓口は上から順に実行する。 */
export type SheetStep =
  | { do: "unmerge"; range: string }
  | { do: "insertRowsAfter"; row: number; count: number }
  /** 文字は入力したとおりの文字として書かれ、= で始まっても数式にならない。 */
  | { do: "values"; range: string; values: Array<Array<string | number>> }
  | { do: "merge"; range: string }
  | { do: "showRows"; from: number; count: number }
  | { do: "hideRows"; from: number; count: number }
  | { do: "rowHeight"; row: number; px: number }
  | {
      do: "format";
      range: string;
      wrap?: boolean;
      vertical?: "top" | "middle" | "bottom";
      horizontal?: "left" | "center" | "right";
    }
  | { do: "borderBottom"; range: string };

export type GatewayCall =
  | { op: "info" }
  | { op: "ensureTabs"; tabs: Array<{ name: string; header: string[] }> }
  | { op: "read"; tabs: string[] }
  | { op: "append"; tab: string; rows: string[][] }
  | { op: "updateById"; tab: string; id: string; row: string[] }
  | { op: "upsertById"; tab: string; id: string; row: string[] }
  | { op: "deleteById"; tab: string; id: string }
  | { op: "nextSeq"; tab: string; key: string; floor: number }
  | {
      op: "renderSheet";
      template: string;
      name: string;
      replaceGid?: string;
      /** 前のタブの名前。印の無い古いタブを消すときの照合に使う。 */
      replaceName?: string;
      steps: SheetStep[];
      save?: {
        tab: string;
        id: string;
        row: string[];
        fill: Record<number, keyof RenderedSheet>;
      };
    }
  | { op: "deleteSheet"; gid: string; name?: string }
  | { op: "exportPdf"; gid: string; params: Record<string, string> };

/** 窓口が作った帳票のタブ。 */
export interface RenderedSheet {
  gid: string;
  name: string;
  spreadsheetId: string;
  url: string;
}

export type GatewayErrorCode =
  | "unreachable"
  | "unauthorized"
  | "not_configured"
  | "bad_request"
  | "not_found"
  | "busy"
  | "internal";

export class GatewayError extends Error {
  readonly code: GatewayErrorCode;

  constructor(code: GatewayErrorCode, message: string) {
    super(message);
    this.name = "GatewayError";
    this.code = code;
  }
}

function decodeBase64Url(text: string): string {
  const base64 = text.replace(/-/g, "+").replace(/_/g, "/");
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** 接続コードを接続先と鍵に分ける。形が違えば null。 */
export function parseConnectionCode(code: string): Connection | null {
  const trimmed = code.trim();
  if (!trimmed.startsWith(CODE_PREFIX)) return null;
  try {
    const data: unknown = JSON.parse(
      decodeBase64Url(trimmed.slice(CODE_PREFIX.length)),
    );
    if (typeof data !== "object" || data === null) return null;
    const { u, k, s } = data as { u?: unknown; k?: unknown; s?: unknown };
    if (typeof u !== "string" || !WEB_APP_URL.test(u)) return null;
    if (typeof k !== "string" || k.length < 32) return null;
    if (typeof s !== "string" || !/^[\w-]{20,}$/.test(s)) return null;
    return { url: u, key: k, spreadsheetId: s };
  } catch {
    return null;
  }
}

/** 設定されている接続コード。未設定なら null、形が違えば例外。 */
export function getConnection(): Connection | null {
  const code = process.env.KEIRI_CONNECTION;
  if (!code) return null;
  const connection = parseConnectionCode(code);
  if (!connection) {
    throw new Error(
      "KEIRI_CONNECTION の形が違います。スプレッドシートのメニュー「keiri-app」から接続コードを発行し直してください",
    );
  }
  return connection;
}

/** スプレッドシートのタブを開く URL。保存先が未設定なら null。 */
export function sheetTabUrl(gid: string): string | null {
  const connection = getConnection();
  return connection
    ? `https://docs.google.com/spreadsheets/d/${connection.spreadsheetId}/edit#gid=${gid}`
    : null;
}

export function hasConnection(): boolean {
  return Boolean(process.env.KEIRI_CONNECTION);
}

type Transport = (connection: Connection, body: string) => Promise<string>;

const fetchTransport: Transport = async (connection, body) => {
  const response = await fetch(connection.url, {
    method: "POST",
    headers: { "content-type": "text/plain;charset=utf-8" },
    body,
    redirect: "follow",
  });
  return response.text();
};

let transport: Transport = fetchTransport;

/** テストで、通信の代わりに窓口のコードを直接呼ぶために差し替える。 */
export function setGatewayTransport(next: Transport | null): void {
  transport = next ?? fetchTransport;
}

/**
 * 窓口へ操作をまとめて送り、操作ごとの結果を同じ順で受け取る。
 * 書き込みを含むまとまりは、窓口がロックを取ってから順に実行する。
 */
export async function callGateway<T extends unknown[] = unknown[]>(
  calls: GatewayCall[],
): Promise<T> {
  const connection = getConnection();
  if (!connection) {
    throw new GatewayError("not_configured", "KEIRI_CONNECTION が未設定です");
  }

  let text: string;
  try {
    text = await transport(
      connection,
      JSON.stringify({ key: connection.key, calls }),
    );
  } catch (error) {
    throw new GatewayError(
      "unreachable",
      `スプレッドシートに届きませんでした: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  let body: {
    ok?: boolean;
    results?: unknown[];
    error?: { code?: GatewayErrorCode; message?: string };
  };
  try {
    body = JSON.parse(text);
  } catch {
    throw new GatewayError(
      "unreachable",
      "スプレッドシートから想定外の応答が返りました。ウェブアプリのデプロイで「アクセスできるユーザー」が「全員」になっているかを確かめてください",
    );
  }
  if (!body.ok || !Array.isArray(body.results)) {
    throw new GatewayError(
      body.error?.code ?? "internal",
      body.error?.message ?? "スプレッドシート側でエラーが起きました",
    );
  }
  return body.results as T;
}
