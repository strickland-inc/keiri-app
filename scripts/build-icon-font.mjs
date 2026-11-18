/**
 * アイコン用フォント（Material Symbols）を、コードで使っているアイコンだけで作る。
 *   全部入りのフォントは約 4MB。使う分だけにすると数 KB〜数十 KB になり、自前（同じサイト）から配信できる。
 *
 *   npm run icons          フォントを作り直す（public/fonts/material-symbols.woff2）。ネットワークが必要
 *   npm run icons:check    コードで使っているアイコンが、フォントに含まれているか確認する（ネットワーク不要・CI 向け）
 *                          名前が実在するかは `npm run icons` のときに確認する
 *
 * 新しいアイコン名を `<Icon name="…" />` などで使ったら、`npm run icons` を実行してフォントとリストをコミットする。
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SRC_DIR = path.join(ROOT, "src");
const FONT_FILE = path.join(ROOT, "public/fonts/material-symbols.woff2");
const NAMES_FILE = path.join(ROOT, "public/fonts/material-symbols.names.json");
const check = process.argv.includes("--check");

// 固定する軸: 文字サイズ 24 / 太さ 300（細め）/ 塗りつぶし 0〜1（filled 用）/ 強調 0
const AXES = "opsz,wght,FILL,GRAD@24,300,0..1,0";
const CSS_URL = "https://fonts.googleapis.com/css2";
// woff2 を返してもらうため、モダンなブラウザを名乗る
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (/\.(tsx?|mjs)$/.test(entry.name) && !/\.test\./.test(entry.name))
      yield full;
  }
}

/** コード中のアイコン名を集める: <Icon name="x" /> / name={cond ? "a" : "b"} / `icon: "x"` / `icon="x"`。 */
function collectUsedIcons() {
  const used = new Map(); // 名前 → 使っているファイル
  const add = (name, file) => {
    if (/^[a-z][a-z0-9_]*$/.test(name))
      used.set(name, used.get(name) ?? path.relative(ROOT, file));
  };
  for (const file of walk(SRC_DIR)) {
    const text = fs.readFileSync(file, "utf8");
    for (const m of text.matchAll(
      /<Icon\b[^>]*?\bname=(?:"([^"]+)"|\{([^}]*)\})/gs,
    )) {
      if (m[1]) add(m[1], file);
      else
        for (const s of m[2].matchAll(/["']([a-z0-9_]+)["']/g)) add(s[1], file);
    }
    for (const m of text.matchAll(/\bicon\s*(?::|=)\s*\{?\s*"([a-z0-9_]+)"/g))
      add(m[1], file);
    for (const m of text.matchAll(/\bicon(?:Name)?\s*=\s*\{([^}]*)\}/g)) {
      for (const s of m[1].matchAll(/"([a-z0-9_]+)"/g)) add(s[1], file);
    }
  }
  return used;
}

const used = collectUsedIcons();
const names = [...used.keys()].sort();

if (check) {
  const built = fs.existsSync(NAMES_FILE)
    ? new Set(JSON.parse(fs.readFileSync(NAMES_FILE, "utf8")))
    : new Set();
  const missing = names.filter((n) => !built.has(n));
  if (missing.length > 0) {
    console.error(
      "フォントに含まれていないアイコンがあります。`npm run icons` を実行してください:",
    );
    for (const n of missing) console.error(`  - ${n}  (${used.get(n)})`);
    process.exit(1);
  }
  console.log(
    `OK: ${names.length} 個のアイコンがすべてフォントに含まれています。`,
  );
  process.exit(0);
}

/** 指定したアイコンだけのフォント（woff2）を Google Fonts から取得する。 */
async function fetchSubsetFont(iconNames) {
  const cssUrl = `${CSS_URL}?family=Material+Symbols+Outlined:${AXES}&icon_names=${iconNames.join(",")}&display=block`;
  const css = await (
    await fetch(cssUrl, { headers: { "User-Agent": USER_AGENT } })
  ).text();
  const fontUrl = css.match(/url\((https:\/\/fonts\.gstatic\.com[^)]+)\)/)?.[1];
  if (!fontUrl) throw new Error("フォントの URL を取得できませんでした。");
  return Buffer.from(
    await (
      await fetch(fontUrl, { headers: { "User-Agent": USER_AGENT } })
    ).arrayBuffer(),
  );
}

// 存在しない名前が混ざると、Google は全部入りの大きなフォントを返す。サイズで検出する。
const SUBSET_MAX_BYTES = 150_000;

async function findInvalidNames(iconNames) {
  const invalid = [];
  for (const name of iconNames) {
    if ((await fetchSubsetFont([name])).length > SUBSET_MAX_BYTES)
      invalid.push(name);
  }
  return invalid;
}

const font = await fetchSubsetFont(names);
if (font.length > SUBSET_MAX_BYTES) {
  const invalid = await findInvalidNames(names);
  console.error("存在しないアイコン名があります（綴りを確認してください）:");
  for (const n of invalid) console.error(`  - ${n}  (${used.get(n)})`);
  process.exit(1);
}

fs.mkdirSync(path.dirname(FONT_FILE), { recursive: true });
fs.writeFileSync(FONT_FILE, font);
fs.writeFileSync(NAMES_FILE, JSON.stringify(names, null, 2) + "\n");
console.log(
  `作成しました: ${path.relative(ROOT, FONT_FILE)}（${names.length} 個, ${(font.length / 1024).toFixed(1)} KB）`,
);
