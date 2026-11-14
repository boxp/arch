// Run from web/: npm install --no-save --package-lock=false sharp && node scripts/generate-pwa-icons.mjs
import sharp from 'sharp'
const source = 'public/kohako/studio/c48v6-idle-color.png'
const dest = 'public/kohako/icons'
// 72px source: crop the face and hair, keeping the original pixel-art edges.
const face = await sharp(source).extract({ left: 8, top: 1, width: 56, height: 56 }).png().toBuffer()
for (const size of [32, 180, 192, 512]) {
  await sharp(face).resize(size, size, { kernel: 'nearest' }).png().toFile(`${dest}/icon-${size}-v1.png`)
}
const inset = await sharp(face).resize(288, 288, { kernel: 'nearest' }).png().toBuffer()
await sharp({ create: { width: 512, height: 512, channels: 4, background: '#f3eef9' } })
  .composite([{ input: inset, left: 112, top: 112 }])
  .png()
  .toFile(`${dest}/icon-maskable-512-v1.png`)
