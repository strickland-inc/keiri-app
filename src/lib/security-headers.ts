/**
 * 全応答に付ける応答ヘッダー。proxy.ts が import するので、Node 専用の依存や Repository を足さない。
 *
 * CSP の判断（Next.js 16 と vinext で確かめたこと）:
 * - script-src は 'self' 'unsafe-inline'。Next.js と vinext は、ハイドレーションのためのインラインの
 *   <script> を HTML に埋める。nonce を配るには全ページを要求ごとの動的な描画にする必要があり、
 *   Cloudflare Workers の無料枠（CPU 10ms）で全画面を動的にするのは割に合わないので nonce は使わない。
 *   外部のスクリプトは読まないので、'self' が効く。
 * - style-src は 'self' 'unsafe-inline'。画面の多くが style 属性（棒グラフの幅、撮影画面の余白）を使う。
 * - img-src は data: と blob:。2段階認証の QR は data URL の SVG、レシート撮影の画像は blob:。
 * - font-src は 'self'。Google Fonts は使わず、アイコンフォントは /fonts から自前で配る。
 * - connect-src は 'self'。ブラウザから呼ぶのは同じオリジンの /api だけ（外部の API はサーバーから呼ぶ）。
 * - 開発時だけ、HMR のために 'unsafe-eval' と ws: を足す。
 */

export interface SecurityHeaderOptions {
  pathname: string;
  /** NODE_ENV === "production" か。HSTS と開発用の緩めの CSP の切り替えに使う。 */
  production: boolean;
}

/** トークンが URL に入る画面。Referer に漏らさず、応答も残さない。 */
const TOKEN_PATH = /^\/(?:invite|reset)(?:\/|$)/;

export function isTokenPath(pathname: string): boolean {
  return TOKEN_PATH.test(pathname);
}

export function contentSecurityPolicy(production: boolean): string {
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${production ? "" : " 'unsafe-eval'"}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self'${production ? "" : " ws: wss:"}`,
    "media-src 'self' blob:",
    "manifest-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ];
  return directives.join("; ");
}

export function securityHeaders({
  pathname,
  production,
}: SecurityHeaderOptions): Record<string, string> {
  const headers: Record<string, string> = {
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "same-origin",
    // レシートの撮影（getUserMedia）に、自分のオリジンだけカメラを許す
    "Permissions-Policy":
      "camera=(self), microphone=(), geolocation=(), payment=(), usb=()",
    "Content-Security-Policy": contentSecurityPolicy(production),
  };
  if (production) {
    headers["Strict-Transport-Security"] =
      "max-age=31536000; includeSubDomains";
  }
  if (isTokenPath(pathname)) {
    headers["Referrer-Policy"] = "no-referrer";
    headers["Cache-Control"] = "no-store";
  }
  return headers;
}
