// Run from web/: npm install --no-save --package-lock=false sharp && node scripts/generate-pwa-icons.mjs
// 元絵は作画資料 kohako-exe-navigation-ai-character-sheet-final.png (2752x1536) の左上の胸像。
// scripts/kohako-sheet-face-source.png はその (451, 2) から 520x520 を無加工で切り出したもの。描き直し・生成はしない。
import sharp from 'sharp'
const source = 'scripts/kohako-sheet-face-source.png'
const dest = 'public/kohako/icons'
// 資料の白い地を家の地色に寄せる（線と色はそのまま、乗算で白だけが地色になる）。
const tint = async (input, size) =>
  sharp(input)
    .composite([
      { input: { create: { width: size, height: size, channels: 3, background: '#f3eef9' } }, blend: 'multiply' },
    ])
    .png({ compressionLevel: 9 })
// 顔・前髪・桜の髪飾りが入る 340px 四方。
const face = await sharp(source).extract({ left: 85, top: 70, width: 340, height: 340 }).png().toBuffer()
for (const size of [32, 180, 192, 512]) {
  const resized = await sharp(face).resize(size, size, { kernel: 'lanczos3' }).png().toBuffer()
  await (await tint(resized, size)).toFile(`${dest}/icon-${size}-v2.png`)
}
// maskable は切り出し全体を使う。目・口・輪郭は中央 80% の円に収まり、端で切れるのは髪と衣装だけ。
const wide = await sharp(source).resize(512, 512, { kernel: 'lanczos3' }).png().toBuffer()
await (await tint(wide, 512)).toFile(`${dest}/icon-maskable-512-v2.png`)
