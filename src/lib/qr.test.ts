import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { qrMatrix, qrSvg, qrVersionFor } from "./qr.ts";

/**
 * 期待値は、既知の正しい実装（python-qrcode 、バイトモード、誤り訂正 M）が同じ版・同じマスクで作った行列。
 * 行列を 1 行ずつ「0/1」にして改行でつないだ文字列の SHA-256 で突き合わせる。
 */
const REFERENCE = [
  {
    text: "hello world",
    version: 1,
    mask: 3,
    sha: "51672c7be5800174ed75f085eb2759b81a4a531f347e1ef211f442bb5b013830",
  },
  {
    text: "otpauth://totp/keiri-app:admin?secret=JBSWY3DPEHPK3PXP&issuer=keiri-app",
    version: 5,
    mask: 2,
    sha: "cf500a215935da63975935822fc642a8238171720d74684a386a46bcb64a93a2",
  },
  // 版 7 以上は、版情報のモジュールが付く
  {
    text: "otpauth://totp/keiri-app:taro.yamada%40example.co.jp?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=keiri-app",
    version: 7,
    mask: 5,
    sha: "a6cc2bda4050360668c6780dd763ee4742587bb60f1b8f4b5875738986331bc6",
  },
  {
    text: "a".repeat(110),
    version: 7,
    mask: 1,
    sha: "d20dde52d6b075773a6e284ebe83a1523ae25e96c2379f99877999220f2a9beb",
  },
  {
    text: "b".repeat(150),
    version: 8,
    mask: 4,
    sha: "1ec11390ce1a4e51802a20c290795c9c3c8c31d352ea3d9bbaa80d2fdf29d90d",
  },
  {
    text: "c".repeat(175),
    version: 9,
    mask: 6,
    sha: "3db6b76b147e56194006445132c534378891067600e6409687f435bcba4b4dd8",
  },
  // 版 10 は、文字数の欄が 16 ビットになる
  {
    text: "d".repeat(213),
    version: 10,
    mask: 7,
    sha: "8c984eb98fa9a2d9360980fd7335e0ea4af55f0ad9441364e812e824f35aaa0a",
  },
  {
    text: "あいう",
    version: 1,
    mask: 0,
    sha: "24de482b02a175ca1e17a4a1b07cadbff0ebee9f7ad0740fa70d22e3458de263",
  },
  {
    text: "e".repeat(40),
    version: 3,
    mask: 2,
    sha: "e8a036d4dd357fec681804911c1d47bcdb9dd504e302b260b898b881d6a3c12b",
  },
  {
    text: "f".repeat(60),
    version: 4,
    mask: 3,
    sha: "8d26c40a6970cfe8ebeded6b328e0368f358076e6a9801cb3b3fbcb4d0d56398",
  },
  {
    text: "g".repeat(100),
    version: 6,
    mask: 4,
    sha: "f2008ea11be412c63e3d2953c0640dcc157d34eecf0e53716111a39e019dce6c",
  },
];

const HELLO_V1_MASK0 = [
  "111111100111001111111",
  "100000101011001000001",
  "101110100010001011101",
  "101110100011001011101",
  "101110101010101011101",
  "100000100110101000001",
  "111111101010101111111",
  "000000000101100000000",
  "101010100101000010010",
  "101010000110001000010",
  "000001100110100011111",
  "101011010110001000010",
  "011001110110101010100",
  "000000001011010100110",
  "111111100001011100111",
  "100000100011110110000",
  "101110101011011100111",
  "101110100100001100110",
  "101110101010100010101",
  "100000100110001010010",
  "111111101010101100111",
];

function rows(text: string, version: number, mask: number): string {
  return qrMatrix(text, { version, mask })
    .map((row) => row.map((dark) => (dark ? "1" : "0")).join(""))
    .join("\n");
}

test("既知の正しい実装の行列と一致する（版 1〜10）", () => {
  for (const c of REFERENCE) {
    const hash = createHash("sha256")
      .update(rows(c.text, c.version, c.mask))
      .digest("hex");
    assert.equal(hash, c.sha, `版 ${c.version} マスク ${c.mask}`);
  }
});

test("HELLO（版 1）の行列がそのまま一致する", () => {
  assert.equal(rows("HELLO", 1, 0), HELLO_V1_MASK0.join("\n"));
});

test("入力に合わせて最小の版を選ぶ", () => {
  assert.equal(qrVersionFor("a".repeat(14)), 1);
  assert.equal(qrVersionFor("a".repeat(15)), 2);
  assert.equal(qrVersionFor("a".repeat(106)), 6);
  assert.equal(qrVersionFor("a".repeat(107)), 7);
  assert.equal(qrVersionFor("a".repeat(213)), 10);
  assert.throws(() => qrVersionFor("a".repeat(214)), /長すぎ/);
  const matrix = qrMatrix(
    "otpauth://totp/keiri-app:admin?secret=JBSWY3DPEHPK3PXP&issuer=keiri-app",
  );
  assert.equal(matrix.length, 17 + 4 * 5);
});

test("マスクを選ぶと、どのマスクでも版・大きさ・位置検出パターンが保たれる", () => {
  const matrix = qrMatrix("keiri-app");
  assert.equal(matrix.length, 21);
  // 左上の位置検出パターン（7×7 の外枠は暗い）
  for (let i = 0; i < 7; i++) {
    assert.equal(matrix[0][i], true);
    assert.equal(matrix[6][i], true);
    assert.equal(matrix[i][0], true);
    assert.equal(matrix[i][6], true);
  }
  assert.equal(matrix[3][3], true);
  assert.equal(matrix[1][1], false);
  assert.equal(matrix[2][2], true);
});

test("SVG は、余白つきの viewBox と黒の経路を持つ", () => {
  const svg = qrSvg("HELLO", { version: 1, mask: 0 });
  assert.match(svg, /^<svg [^>]*viewBox="0 0 29 29"/);
  assert.match(svg, /fill="#000000"/);
  assert.match(svg, /fill="#ffffff"/);
  // 1 行目の暗いモジュールは、余白 4 の位置から 7 つ続く
  assert.ok(svg.includes("M4,4h7v1h-7z"));
});
