import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const iconsDir = join(root, 'icons');
const sourcePath = join(iconsDir, 'app-icon.png');

async function buildIcon(size) {
  const radius = Math.round(size * 0.1875);
  const inset = Math.round(size * 0.08);
  const inner = size - inset * 2;

  const background = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
      <rect width="${size}" height="${size}" rx="${radius}" fill="#ffffff"/>
    </svg>`
  );

  const icon = await sharp(sourcePath)
    .resize(inner, inner, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
    .png()
    .toBuffer();

  return sharp(background)
    .composite([{ input: icon, top: inset, left: inset }])
    .png()
    .toBuffer();
}

await mkdir(iconsDir, { recursive: true });

for (const size of [192, 512]) {
  const png = await buildIcon(size);
  const pngPath = join(iconsDir, `icon-${size}.png`);
  await sharp(png).toFile(pngPath);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" role="img" aria-label="Ekawent">
  <rect width="${size}" height="${size}" fill="#ffffff"/>
  <image href="/icons/icon-${size}.png" width="${size}" height="${size}"/>
</svg>`;
  await writeFile(join(iconsDir, `icon-${size}.svg`), svg, 'utf8');
  console.log('Wrote', pngPath);
}
