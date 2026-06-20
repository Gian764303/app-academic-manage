import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const iconsDir = join(root, 'icons');
const sourcePath = join(iconsDir, 'icon.svg');

async function buildIcon(size, { maskable = false } = {}) {
  const radius = Math.round(size * 0.1875);
  const inset = Math.round(size * (maskable ? 0.2 : 0.12));
  const inner = size - inset * 2;
  const density = Math.max(144, Math.ceil((inner / 128) * 96));

  const background = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
      <rect width="${size}" height="${size}" rx="${radius}" fill="#ffffff"/>
    </svg>`
  );

  const icon = await sharp(sourcePath, { density })
    .resize(inner, inner, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
    .png()
    .toBuffer();

  return sharp(background)
    .composite([{ input: icon, top: inset, left: inset }])
    .png()
    .toBuffer();
}

await mkdir(iconsDir, { recursive: true });

for (const size of [16, 32, 192, 512]) {
  const pngPath = join(iconsDir, `icon-${size}.png`);
  await sharp(await buildIcon(size)).toFile(pngPath);
  console.log('Wrote', pngPath);
}

const maskable512 = await buildIcon(512, { maskable: true });
await sharp(maskable512).toFile(join(iconsDir, 'icon-512-maskable.png'));
console.log('Wrote', join(iconsDir, 'icon-512-maskable.png'));

const favicon32 = await buildIcon(32);
await sharp(favicon32).toFile(join(root, 'favicon.ico'));
console.log('Wrote', join(root, 'favicon.ico'));
