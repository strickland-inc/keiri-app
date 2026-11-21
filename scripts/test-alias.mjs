/**
 * テスト用の読み込みの補助。`node --import ./scripts/test-alias.mjs --test …` で使う。
 * アプリのコードは `@/…`（src の下を指す別名）と、拡張子を省いた相対パスで import している。
 * Node はどちらも解決できないので、ここで実際のファイルに読み替える。
 */
import fs from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const src = path.resolve(import.meta.dirname, "../src");

function findFile(base) {
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
  ];
  return candidates.find(
    (candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile(),
  );
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    let base = null;
    if (specifier.startsWith("@/")) {
      base = path.join(src, specifier.slice(2));
    } else if (
      specifier.startsWith(".") &&
      context.parentURL?.startsWith("file:") &&
      !path.extname(specifier)
    ) {
      base = path.resolve(
        path.dirname(fileURLToPath(context.parentURL)),
        specifier,
      );
    }
    const file = base && findFile(base);
    return nextResolve(file ? pathToFileURL(file).href : specifier, context);
  },
});
