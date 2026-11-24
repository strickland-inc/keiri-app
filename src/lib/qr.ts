/**
 * QR コード（依存なし）。バイトモード、誤り訂正レベル M、版 1〜10（最大 213 バイト）。
 * 2段階認証の otpauth:// URI（100〜150 バイト）を描くのに足りる範囲だけを持つ。
 * 版は入力の長さから自動で選び、マスクは ISO/IEC 18004 の減点規則で最も小さいものを選ぶ。
 * 出力は、既知の正しい実装（python-qrcode）が作る行列との一致をテストで確かめている（qr.test.ts）。
 */

export type QrMatrix = boolean[][];

export interface QrOptions {
  /** 版を指定する（1〜10）。省略すると、入力が入る最小の版。テスト用。 */
  version?: number;
  /** マスクの番号（0〜7）を指定する。省略すると減点が最小のもの。テスト用。 */
  mask?: number;
}

/** 版ごとの、誤り訂正 M の構成。[ブロックあたりの誤り訂正語数, [[ブロック数, ブロックあたりのデータ語数], …]] */
const EC_M: ReadonlyArray<
  readonly [number, ReadonlyArray<readonly [number, number]>]
> = [
  [10, [[1, 16]]], // 1
  [16, [[1, 28]]], // 2
  [26, [[1, 44]]], // 3
  [18, [[2, 32]]], // 4
  [24, [[2, 43]]], // 5
  [16, [[4, 27]]], // 6
  [18, [[4, 31]]], // 7
  [
    22,
    [
      [2, 38],
      [2, 39],
    ],
  ], // 8
  [
    22,
    [
      [3, 36],
      [2, 37],
    ],
  ], // 9
  [
    26,
    [
      [4, 43],
      [1, 44],
    ],
  ], // 10
];

/** 位置合わせパターンの中心の座標（版 1 は無し）。 */
const ALIGNMENT: ReadonlyArray<readonly number[]> = [
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
];

const MAX_VERSION = EC_M.length;

function dataCodewords(version: number): number {
  const [, groups] = EC_M[version - 1];
  return groups.reduce((sum, [count, size]) => sum + count * size, 0);
}

/** バイトモードで入る最大のバイト数。 */
function byteCapacity(version: number): number {
  const headerBits = 4 + (version < 10 ? 8 : 16);
  return Math.floor((dataCodewords(version) * 8 - headerBits) / 8);
}

// ── GF(256) と Reed-Solomon ───────────────────────────────────────────────────

function gfMultiply(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

function rsDivisor(degree: number): number[] {
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = gfMultiply(result[j], root);
      if (j + 1 < degree) result[j] ^= result[j + 1];
    }
    root = gfMultiply(root, 0x02);
  }
  return result;
}

function rsRemainder(data: number[], divisor: number[]): number[] {
  const result = new Array<number>(divisor.length).fill(0);
  for (const byte of data) {
    const factor = byte ^ (result.shift() ?? 0);
    result.push(0);
    divisor.forEach((coef, i) => {
      result[i] ^= gfMultiply(coef, factor);
    });
  }
  return result;
}

// ── データの符号化 ────────────────────────────────────────────────────────────

function encodeData(bytes: Uint8Array, version: number): number[] {
  const bits: number[] = [];
  const push = (value: number, length: number): void => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  push(0b0100, 4); // バイトモード
  push(bytes.length, version < 10 ? 8 : 16);
  for (const b of bytes) push(b, 8);
  const capacityBits = dataCodewords(version) * 8;
  push(0, Math.min(4, capacityBits - bits.length)); // 終端
  while (bits.length % 8 !== 0) bits.push(0);
  const codewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    codewords.push(parseInt(bits.slice(i, i + 8).join(""), 2));
  }
  for (let pad = 0xec; codewords.length < dataCodewords(version);) {
    codewords.push(pad);
    pad ^= 0xec ^ 0x11;
  }
  return codewords;
}

/** データ語をブロックに分け、誤り訂正語を付けて、インターリーブした全語を返す。 */
function addErrorCorrection(data: number[], version: number): number[] {
  const [ecLength, groups] = EC_M[version - 1];
  const divisor = rsDivisor(ecLength);
  const dataBlocks: number[][] = [];
  let offset = 0;
  for (const [count, size] of groups) {
    for (let i = 0; i < count; i++) {
      dataBlocks.push(data.slice(offset, offset + size));
      offset += size;
    }
  }
  const ecBlocks = dataBlocks.map((block) => rsRemainder(block, divisor));
  const result: number[] = [];
  const longest = Math.max(...dataBlocks.map((b) => b.length));
  for (let i = 0; i < longest; i++) {
    for (const block of dataBlocks) if (i < block.length) result.push(block[i]);
  }
  for (let i = 0; i < ecLength; i++) {
    for (const block of ecBlocks) result.push(block[i]);
  }
  return result;
}

// ── 行列 ──────────────────────────────────────────────────────────────────────

function bit(value: number, index: number): boolean {
  return ((value >>> index) & 1) !== 0;
}

interface Grid {
  size: number;
  modules: boolean[][];
  isFunction: boolean[][];
}

function setFunction(grid: Grid, x: number, y: number, dark: boolean): void {
  grid.modules[y][x] = dark;
  grid.isFunction[y][x] = true;
}

function drawFinder(grid: Grid, cx: number, cy: number): void {
  for (let dy = -4; dy <= 4; dy++) {
    for (let dx = -4; dx <= 4; dx++) {
      const dist = Math.max(Math.abs(dx), Math.abs(dy));
      const x = cx + dx;
      const y = cy + dy;
      if (x >= 0 && x < grid.size && y >= 0 && y < grid.size) {
        setFunction(grid, x, y, dist !== 2 && dist !== 4);
      }
    }
  }
}

function drawAlignment(grid: Grid, cx: number, cy: number): void {
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      setFunction(
        grid,
        cx + dx,
        cy + dy,
        Math.max(Math.abs(dx), Math.abs(dy)) !== 1,
      );
    }
  }
}

function drawFormat(grid: Grid, mask: number): void {
  // 誤り訂正 M のビットは 00。BCH(15,5) の誤り訂正を付け、0x5412 でマスクする
  const data = (0b00 << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const bits = ((data << 10) | rem) ^ 0x5412;
  const { size } = grid;
  for (let i = 0; i <= 5; i++) setFunction(grid, 8, i, bit(bits, i));
  setFunction(grid, 8, 7, bit(bits, 6));
  setFunction(grid, 8, 8, bit(bits, 7));
  setFunction(grid, 7, 8, bit(bits, 8));
  for (let i = 9; i < 15; i++) setFunction(grid, 14 - i, 8, bit(bits, i));
  for (let i = 0; i < 8; i++) setFunction(grid, size - 1 - i, 8, bit(bits, i));
  for (let i = 8; i < 15; i++)
    setFunction(grid, 8, size - 15 + i, bit(bits, i));
  setFunction(grid, 8, size - 8, true); // 常に暗いモジュール
}

function drawVersion(grid: Grid, version: number): void {
  if (version < 7) return;
  let rem = version;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  const bits = (version << 12) | rem;
  const { size } = grid;
  for (let i = 0; i < 18; i++) {
    const a = size - 11 + (i % 3);
    const b = Math.floor(i / 3);
    setFunction(grid, a, b, bit(bits, i));
    setFunction(grid, b, a, bit(bits, i));
  }
}

function buildFunctionPatterns(version: number): Grid {
  const size = 17 + 4 * version;
  const grid: Grid = {
    size,
    modules: Array.from({ length: size }, () =>
      new Array<boolean>(size).fill(false),
    ),
    isFunction: Array.from({ length: size }, () =>
      new Array<boolean>(size).fill(false),
    ),
  };
  for (let i = 0; i < size; i++) {
    setFunction(grid, 6, i, i % 2 === 0);
    setFunction(grid, i, 6, i % 2 === 0);
  }
  drawFinder(grid, 3, 3);
  drawFinder(grid, size - 4, 3);
  drawFinder(grid, 3, size - 4);
  const positions = ALIGNMENT[version - 1];
  const last = positions.length - 1;
  positions.forEach((cy, i) => {
    positions.forEach((cx, j) => {
      const onFinder =
        (i === 0 && j === 0) ||
        (i === 0 && j === last) ||
        (i === last && j === 0);
      if (!onFinder) drawAlignment(grid, cx, cy);
    });
  });
  drawFormat(grid, 0); // 場所を確保する（本物のマスクは後で書き直す）
  drawVersion(grid, version);
  return grid;
}

function placeCodewords(grid: Grid, codewords: number[]): void {
  const { size } = grid;
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!grid.isFunction[y][x] && i < codewords.length * 8) {
          grid.modules[y][x] = bit(codewords[i >>> 3], 7 - (i & 7));
          i++;
        }
      }
    }
  }
}

function maskApplies(mask: number, x: number, y: number): boolean {
  switch (mask) {
    case 0:
      return (x + y) % 2 === 0;
    case 1:
      return y % 2 === 0;
    case 2:
      return x % 3 === 0;
    case 3:
      return (x + y) % 3 === 0;
    case 4:
      return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5:
      return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6:
      return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    default:
      return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
  }
}

function applyMask(grid: Grid, mask: number): void {
  for (let y = 0; y < grid.size; y++) {
    for (let x = 0; x < grid.size; x++) {
      if (!grid.isFunction[y][x] && maskApplies(mask, x, y)) {
        grid.modules[y][x] = !grid.modules[y][x];
      }
    }
  }
}

// ── 減点（ISO/IEC 18004 の 4 規則）───────────────────────────────────────────

const FINDER_LIKE = [
  [true, false, true, true, true, false, true, false, false, false, false],
  [false, false, false, false, true, false, true, true, true, false, true],
];

function penalty(modules: boolean[][]): number {
  const size = modules.length;
  let score = 0;
  // 規則 1: 同じ色が 5 つ以上続く
  const lines: boolean[][] = [];
  for (let i = 0; i < size; i++) {
    lines.push(modules[i]);
    lines.push(modules.map((row) => row[i]));
  }
  for (const line of lines) {
    let run = 1;
    for (let i = 1; i <= size; i++) {
      if (i < size && line[i] === line[i - 1]) {
        run++;
      } else {
        if (run >= 5) score += 3 + (run - 5);
        run = 1;
      }
    }
    // 規則 3: 1:1:3:1:1 の並びと、その前後の明るい 4 モジュール
    for (let i = 0; i + 11 <= size; i++) {
      for (const pattern of FINDER_LIKE) {
        if (pattern.every((v, k) => line[i + k] === v)) score += 40;
      }
    }
  }
  // 規則 2: 2×2 の同じ色
  for (let y = 0; y + 1 < size; y++) {
    for (let x = 0; x + 1 < size; x++) {
      const c = modules[y][x];
      if (
        c === modules[y][x + 1] &&
        c === modules[y + 1][x] &&
        c === modules[y + 1][x + 1]
      ) {
        score += 3;
      }
    }
  }
  // 規則 4: 暗いモジュールの割合の 50% からのずれ
  const dark = modules.reduce((n, row) => n + row.filter(Boolean).length, 0);
  const percent = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(percent - 50) / 5) * 10;
  return score;
}

// ── 公開 ──────────────────────────────────────────────────────────────────────

/** 入力が入る最小の版（1〜10）。入らなければ例外。 */
export function qrVersionFor(text: string): number {
  const length = new TextEncoder().encode(text).length;
  for (let version = 1; version <= MAX_VERSION; version++) {
    if (length <= byteCapacity(version)) return version;
  }
  throw new Error("QR コードに入れるには長すぎます");
}

/** QR コードの行列（true が暗いモジュール）。quiet zone は含まない。 */
export function qrMatrix(text: string, options: QrOptions = {}): QrMatrix {
  const bytes = new TextEncoder().encode(text);
  const version = options.version ?? qrVersionFor(text);
  if (
    version < 1 ||
    version > MAX_VERSION ||
    bytes.length > byteCapacity(version)
  ) {
    throw new Error("QR コードに入れるには長すぎます");
  }
  const codewords = addErrorCorrection(encodeData(bytes, version), version);
  const base = buildFunctionPatterns(version);
  placeCodewords(base, codewords);

  const finish = (mask: number): boolean[][] => {
    const grid: Grid = {
      size: base.size,
      modules: base.modules.map((row) => [...row]),
      isFunction: base.isFunction,
    };
    applyMask(grid, mask);
    drawFormat(grid, mask);
    return grid.modules;
  };

  if (options.mask !== undefined) return finish(options.mask);
  let best = finish(0);
  let bestScore = penalty(best);
  for (let mask = 1; mask < 8; mask++) {
    const candidate = finish(mask);
    const score = penalty(candidate);
    if (score < bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

/**
 * QR コードの SVG 文字列。周りに 4 モジュールの余白を付ける。
 * 読み取りには明暗の差が要るので、ダークモードでも黒と白のままにする（色を変えない）。
 */
export function qrSvg(text: string, options: QrOptions = {}): string {
  const matrix = qrMatrix(text, options);
  const border = 4;
  const total = matrix.length + border * 2;
  const path: string[] = [];
  matrix.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      if (!row[x]) {
        x++;
        continue;
      }
      const start = x;
      while (x < row.length && row[x]) x++;
      path.push(
        `M${start + border},${y + border}h${x - start}v1h-${x - start}z`,
      );
    }
  });
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" ` +
    `shape-rendering="crispEdges" role="img" aria-label="2段階認証の QR コード">` +
    `<rect width="${total}" height="${total}" fill="#ffffff"/>` +
    `<path d="${path.join("")}" fill="#000000"/></svg>`
  );
}
