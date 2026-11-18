/**
 * PWA アイコンを生成する（ブランドの緑に白の "K"）。
 *   npm install --no-save sharp && node scripts/gen-icons.mjs
 * sharp は依存に入れていない（アイコンを作り直すときだけ使うため）。
 * 出力: public/icon-192.png / icon-512.png / icon-maskable-512.png / apple-touch-icon.png
 */
import sharp from "sharp";
import path from "node:path";

const PUB = path.resolve("./public");
const GREEN = "#00ac3a";

// 全面グリーン＋中央に白の "K"。中央寄せ・余白ありで maskable セーフゾーンも満たす。
function svg(size, fontScale) {
  const fs = Math.round(size * fontScale);
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
       <rect width="${size}" height="${size}" fill="${GREEN}"/>
       <text x="50%" y="50%" font-family="Helvetica, Arial, sans-serif" font-size="${fs}"
             font-weight="700" letter-spacing="${-fs * 0.04}" fill="#ffffff"
             text-anchor="middle" dominant-baseline="central">K</text>
     </svg>`,
  );
}

async function out(name, size, fontScale) {
  await sharp(svg(size, fontScale)).png().toFile(path.join(PUB, name));
  console.log("生成:", name);
}

// 標準アイコン（やや大きめの文字）。maskable はセーフゾーン確保のため文字を小さめに。
await out("icon-192.png", 192, 0.46);
await out("icon-512.png", 512, 0.46);
await out("icon-maskable-512.png", 512, 0.36);
await out("apple-touch-icon.png", 180, 0.46);
console.log("完了。");
