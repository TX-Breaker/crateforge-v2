/**
 * Genera le icone dell'applicazione dai QUATTRO disegni del marchio
 * (specifica logo §03 e §06), non ricampionando un unico PNG grande.
 *
 * Perché non basta un solo file: sotto i 32px i tratti del disegno grande
 * cadono sotto il pixel fisico e i tre dorsi si fondono in una macchia. Ogni
 * misura riceve quindi il disegno pensato per lei — 16px due dorsi, 20-24px
 * dorsi larghi senza raggio, 32px tratto più pesante, 48px e oltre geometria
 * piena — e l'.ico le contiene tutte.
 *
 *   node scripts/make-icons.cjs
 *
 * Produce:
 *   build/icon.ico   Windows, 16→256, un disegno per misura
 *   build/icon.png   1024px con smusso a squircle (10% di margine): da questo
 *                    electron-builder ricava l'.icns per macOS
 *   build/icon-512.png  anteprime e store
 */
const { writeFileSync, mkdirSync } = require('fs');
const { join } = require('path');
const sharp = require('sharp');
const pngToIco = require('png-to-ico');

const AMBER = '#E8912E';
const INK = '#0A0B0D';

/** I quattro disegni, identici a src/renderer/src/components/Brand.tsx. */
const D = {
  a: {
    s: 6,
    f: 'M10 13V45a6 6 0 0 0 6 6h32a6 6 0 0 0 6-6V13',
    r: [
      [18.5, 26, 7, 22],
      [28.5, 20, 7, 28],
      [38.5, 30, 7, 18]
    ],
    rx: 1.5
  },
  b: {
    s: 6.5,
    f: 'M10 13V45a6 6 0 0 0 6 6h32a6 6 0 0 0 6-6V13',
    r: [
      [18.5, 26, 7, 22],
      [28.5, 20, 7, 28],
      [38.5, 30, 7, 18]
    ],
    rx: 1.5
  },
  c: {
    s: 7,
    f: 'M10 13V45a6 6 0 0 0 6 6h32a6 6 0 0 0 6-6V13',
    r: [
      [18.5, 27, 7, 21],
      [28.5, 21, 7, 27],
      [38.5, 31, 7, 17]
    ],
    rx: 1
  },
  d: {
    s: 9,
    f: 'M12 14V44a6 6 0 0 0 6 6h28a6 6 0 0 0 6-6V14',
    r: [
      [22, 28, 8, 18],
      [34, 23, 8, 23]
    ],
    rx: 1
  }
};

const pick = (px) => (px >= 40 ? D.a : px >= 28 ? D.b : px >= 20 ? D.c : D.d);

/**
 * Piastrella + marchio in negativo. Il marchio occupa il 62% della piastrella:
 * è ciò che lo tiene otticamente della stessa misura in un dock e in una barra
 * delle applicazioni, che hanno margini diversi.
 *
 * @param px  lato dell'icona
 * @param opts.inset  margine attorno alla piastrella (squircle macOS: 10%)
 * @param opts.radius raggio della piastrella in frazione del lato
 */
function tileSvg(px, opts = {}) {
  const inset = opts.inset ?? 0;
  const radiusRatio = opts.radius ?? 0.22;
  const d = pick(px);
  const tile = px * (1 - inset * 2);
  const off = px * inset;
  const r = tile * radiusRatio;
  // Il marchio è disegnato su griglia 64: lo si porta al 62% della piastrella.
  const markSize = tile * 0.62;
  const markOff = off + (tile - markSize) / 2;
  const scale = markSize / 64;

  const spines = d.r
    .map(([x, y, w, h], i) => {
      const fill = INK;
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${d.rx}" fill="${fill}" data-i="${i}"/>`;
    })
    .join('');

  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${px} ${px}">` +
      `<rect x="${off}" y="${off}" width="${tile}" height="${tile}" rx="${r}" fill="${AMBER}"/>` +
      `<g transform="translate(${markOff} ${markOff}) scale(${scale})" fill="none">` +
      `<path d="${d.f}" stroke="${INK}" stroke-width="${d.s}" stroke-linecap="square"/>` +
      spines +
      `</g></svg>`
  );
}

async function main() {
  const out = join(__dirname, '..', 'build');
  mkdirSync(out, { recursive: true });

  // Windows: quadrato a pieno taglio, nessun margine (§06).
  const winSizes = [16, 24, 32, 48, 64, 128, 256];
  const pngs = [];
  for (const px of winSizes) {
    const buf = await sharp(tileSvg(px, { inset: 0, radius: 0.22 }))
      .png()
      .toBuffer();
    pngs.push(buf);
  }
  writeFileSync(join(out, 'icon.ico'), await pngToIco(pngs));

  // macOS: squircle con 10% di margine dentro il proprio riquadro, raggio
  // 22.4% della piastrella. Nessuna ombra interna, nessun riflesso: la
  // piastrella piatta È l'icona.
  await sharp(tileSvg(1024, { inset: 0.1, radius: 0.224 }))
    .png()
    .toFile(join(out, 'icon.png'));
  await sharp(tileSvg(512, { inset: 0.1, radius: 0.224 }))
    .png()
    .toFile(join(out, 'icon-512.png'));

  console.log(`icone generate in ${out}: icon.ico (${winSizes.join(', ')}), icon.png 1024, icon-512.png`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
