import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  contentSecurityPolicy,
  isTokenPath,
  securityHeaders,
} from "./security-headers.ts";

describe("securityHeaders", () => {
  it("全応答に、枠への埋め込み禁止と MIME の固定を付ける", () => {
    const h = securityHeaders({ pathname: "/", production: true });
    assert.equal(h["X-Frame-Options"], "DENY");
    assert.equal(h["X-Content-Type-Options"], "nosniff");
    assert.equal(h["Referrer-Policy"], "same-origin");
    assert.match(h["Permissions-Policy"], /camera=\(self\)/);
  });

  it("HSTS は本番だけ", () => {
    assert.ok(
      securityHeaders({ pathname: "/", production: true })[
        "Strict-Transport-Security"
      ],
    );
    assert.equal(
      securityHeaders({ pathname: "/", production: false })[
        "Strict-Transport-Security"
      ],
      undefined,
    );
  });

  it("/invite と /reset は no-referrer と no-store", () => {
    for (const pathname of ["/invite/abc", "/reset/abc"]) {
      const h = securityHeaders({ pathname, production: true });
      assert.equal(h["Referrer-Policy"], "no-referrer");
      assert.equal(h["Cache-Control"], "no-store");
    }
    const other = securityHeaders({ pathname: "/login", production: true });
    assert.equal(other["Cache-Control"], undefined);
  });

  it("似た名前のパスはトークンの画面として扱わない", () => {
    assert.equal(isTokenPath("/invitees"), false);
    assert.equal(isTokenPath("/resettings"), false);
    assert.equal(isTokenPath("/invite"), true);
  });
});

describe("contentSecurityPolicy", () => {
  it("埋め込み・base・form・object の4つは必ず絞る", () => {
    for (const production of [true, false]) {
      const csp = contentSecurityPolicy(production);
      assert.match(csp, /frame-ancestors 'none'/);
      assert.match(csp, /base-uri 'self'/);
      assert.match(csp, /form-action 'self'/);
      assert.match(csp, /object-src 'none'/);
    }
  });

  it("QR とレシートの画像を許し、外部のスクリプトは許さない", () => {
    const csp = contentSecurityPolicy(true);
    assert.match(csp, /img-src 'self' data: blob:/);
    assert.match(csp, /script-src 'self' 'unsafe-inline'(;|$)/);
    assert.doesNotMatch(csp, /https?:/);
  });

  it("本番では unsafe-eval を許さない", () => {
    assert.doesNotMatch(contentSecurityPolicy(true), /unsafe-eval/);
    assert.match(contentSecurityPolicy(false), /unsafe-eval/);
  });
});
