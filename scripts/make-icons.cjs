/**
 * Icone dell'applicazione — scala raster completa (§08 della specifica logo).
 *
 * REGOLA CHE CONTA: ogni misura nasce dal PROPRIO disegno, mai da un 1024
 * ricampionato lungo la scala. A 16px il tratto di cornice di un disegno
 * grande finirebbe su 1,4 pixel fisici e diventerebbe la poltiglia grigia che
 * i quattro disegni di §03 esistono per evitare.
 *
 * Nove raster unici coprono dodici slot: macOS riusa quattro file fra le
 * coppie @1x/@2x (32, 256 e 512 servono due slot ciascuno).
 *
 *   node scripts/make-icons.cjs
 *
 * Produce:
 *   build/icon.ico         7 misure (16·20·24·32·48·64·256), quadrato pieno
 *   build/icon.icns        10 slot PNG, squircle con margine
 *   build/icon.png         1024, master per store e fallback
 *   build/icons/*.png      set per Linux (16·32·48·128·256·512)
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
    s: 5.5,
    f: 'M10 13V45a6 6 0 0 0 6 6h32a6 6 0 0 0 6-6V13',
    r: [
      [18.5, 26, 7, 22],
      [28.5, 20, 7, 28],
      [38.5, 30, 7, 18]
    ],
    rx: 1.5
  },
  b: {
    s: 6,
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

/**
 * Disegno per misura, come da tabella §08. Non è una funzione "scegli il più
 * vicino": sono gli abbinamenti dichiarati, uno per riga della tabella.
 */
function drawingFor(px, platform) {
  if (platform === 'win') {
    if (px <= 16) return D.d; // barra del titolo, elenco piccolo
    if (px <= 24) return D.c; // scalature 125% e 150%
    if (px <= 32) return D.b; // barra delle applicazioni, Alt-Tab
    return D.a; // 48 in su
  }
  // macOS: 16 → D, 32 → B, 64 e oltre → A
  if (px <= 16) return D.d;
  if (px <= 32) return D.b;
  return D.a;
}

/**
 * Piastrella + marchio in negativo.
 *
 * macOS inserisce, Windows no: la squircle sta al 90% della propria tela con
 * il marchio al 62% della squircle, l'ico riempie la tela con il marchio al
 * 66%. È quella differenza che li fa sembrare della stessa misura affiancati.
 * Nessuna trasparenza: un angolo trasparente su Windows lascerebbe vedere il
 * desktop attraverso il pulsante della barra.
 */
function tileSvg(px, platform) {
  const d = drawingFor(px, platform);
  const inset = platform === 'mac' ? 0.05 : 0; // 90% della tela = 5% per lato
  const tile = px * (1 - inset * 2);
  const off = px * inset;
  const radius = platform === 'mac' ? tile * 0.224 : tile * 0.22;
  const markRatio = platform === 'mac' ? 0.62 : 0.66;
  const markSize = tile * markRatio;
  const markOff = off + (tile - markSize) / 2;
  const scale = markSize / 64;

  const spines = d.r
    .map(([x, y, w, h]) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${d.rx}" fill="${INK}"/>`)
    .join('');

  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${px} ${px}">` +
      `<rect x="${off}" y="${off}" width="${tile}" height="${tile}" rx="${radius}" fill="${AMBER}"/>` +
      `<g transform="translate(${markOff} ${markOff}) scale(${scale})" fill="none">` +
      `<path d="${d.f}" stroke="${INK}" stroke-width="${d.s}" stroke-linecap="square"/>` +
      spines +
      `</g></svg>`
  );
}

const png = (px, platform) => sharp(tileSvg(px, platform)).png().toBuffer();

/**
 * Assembla un .icns dai PNG. Il formato è una sequenza di blocchi
 * [tipo 4 char][lunghezza uint32 BE incluso l'header][dati], preceduta da
 * 'icns' e dalla lunghezza totale. I tipi usati sono quelli PNG moderni: così
 * ogni slot porta il proprio raster, che è tutto il punto di §08.
 */
function buildIcns(entries) {
  const chunks = entries.map(({ type, data }) => {
    const head = Buffer.alloc(8);
    head.write(type, 0, 4, 'ascii');
    head.writeUInt32BE(data.length + 8, 4);
    return Buffer.concat([head, data]);
  });
  const body = Buffer.concat(chunks);
  const header = Buffer.alloc(8);
  header.write('icns', 0, 4, 'ascii');
  header.writeUInt32BE(body.length + 8, 4);
  return Buffer.concat([header, body]);
}

async function main() {
  const out = join(__dirname, '..', 'build');
  mkdirSync(out, { recursive: true });
  mkdirSync(join(out, 'icons'), { recursive: true });

  /* ---- Windows: sette misure, quadrato pieno ---- */
  const winSizes = [16, 20, 24, 32, 48, 64, 256];
  const winPngs = [];
  for (const px of winSizes) winPngs.push(await png(px, 'win'));
  writeFileSync(join(out, 'icon.ico'), await pngToIco(winPngs));

  /* ---- macOS: nove raster unici su dodici slot ---- */
  const macPx = [16, 32, 64, 128, 256, 512, 1024];
  const mac = {};
  for (const px of macPx) mac[px] = await png(px, 'mac');

  // Tipo → raster. 32, 256 e 512 servono due slot ciascuno (@1x e @2x).
  const icns = buildIcns([
    { type: 'icp4', data: mac[16] }, //   16×16
    { type: 'ic11', data: mac[32] }, //   16×16@2x
    { type: 'icp5', data: mac[32] }, //   32×32   (stesso file di 16@2x)
    { type: 'ic12', data: mac[64] }, //   32×32@2x
    { type: 'ic07', data: mac[128] }, // 128×128
    { type: 'ic13', data: mac[256] }, // 128×128@2x
    { type: 'ic08', data: mac[256] }, // 256×256 (stesso file di 128@2x)
    { type: 'ic14', data: mac[512] }, // 256×256@2x
    { type: 'ic09', data: mac[512] }, // 512×512 (stesso file di 256@2x)
    { type: 'ic10', data: mac[1024] } // 512×512@2x — master per lo store
  ]);
  writeFileSync(join(out, 'icon.icns'), icns);
  writeFileSync(join(out, 'icon.png'), mac[1024]);

  /* ---- Linux: il set PNG così com'è, stessi disegni ---- */
  for (const px of [16, 32, 48, 128, 256, 512]) {
    writeFileSync(join(out, 'icons', `${px}x${px}.png`), await png(px, 'win'));
  }

  console.log(
    `icone generate in ${out}\n` +
      `  icon.ico   ${winSizes.join(' · ')}\n` +
      `  icon.icns  10 slot, ${macPx.length} raster unici\n` +
      `  icons/     16 · 32 · 48 · 128 · 256 · 512 (Linux)`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
