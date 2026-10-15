/**
 * Scarto temporale fra i decoder MP3 dei software DJ.
 *
 * Il problema. Un cue è un istante in millisecondi, ma "il millisecondo 1000"
 * di un MP3 non è lo stesso punto dell'audio in tutti i software. All'inizio
 * di molti MP3 c'è un frame informativo (Xing/Info, spesso con il tag LAME)
 * che non contiene musica: alcuni decoder lo saltano, altri lo decodificano
 * come silenzio, altri ancora sottraggono il ritardo dell'encoder. Il risultato
 * è che lo stesso cue, copiato tale e quale da un software all'altro, cade
 * 26–51 ms prima o dopo il colpo. A 128 BPM sono un decimo di battito: un hot
 * cue che "sbava".
 *
 * Il modulo ha due parti, tenute separate di proposito:
 *
 *  1. `classifyMp3` — guarda i byte del file e lo assegna a uno di quattro
 *     casi (A–D), che dicono come i decoder lo tratteranno. È una proprietà
 *     del file, verificabile.
 *  2. `beatshiftSeconds` — dato il caso, il software da cui viene il cue e
 *     quello a cui va, dice di quanto spostarlo. Sono valori misurati, non
 *     derivati da un principio.
 *
 * ⚠ La seconda parte NON è antisimmetrica: per un file di caso B lo spostamento
 * Traktor→Rekordbox è −26 ms, quello Rekordbox→Traktor +8 ms. Un brano che va e
 * torna fra i due accumulerebbe 18 ms di deriva a ogni giro. Per questo chi
 * usa questa funzione la applica SOLO in uscita, senza mai riscrivere i cue
 * nell'archivio interno, e mai fra un software e se stesso.
 *
 * ⚠⚠ Unica verifica indipendente disponibile, e non concorda. Su una libreria
 * reale, 8 cue Serato che VirtualDJ ha importato da sé dai tag dei file
 * risultano spostati di −26,1 ms (un frame MP3: 1152 campioni a 44,1 kHz). La
 * tabella, per la stessa coppia sugli stessi file, dà −72 ms. O VirtualDJ
 * corregge solo in parte, o la composizione import+export sovrastima per le
 * coppie con VirtualDJ, che il modello tratta come privo di latenza. Finché non
 * c'è una misura che lo chiarisca, la correzione resta un'opzione spenta di
 * serie, con l'anteprima dei numeri davanti a chi la accende.
 */

/* ======================================================= 1. classificazione */

/**
 * - A: nessun frame Xing/Info. Tutti i decoder partono dallo stesso punto.
 * - B: frame Info presente, che i decoder saltano.
 * - C: frame Info presente ma tag LAME corrotto, o encoder noto per scrivere
 *      intestazioni ingannevoli.
 * - D: frame Info presente e trattato come audio da alcuni decoder (+1152
 *      campioni, cioè un frame intero).
 */
export type BeatshiftCase = 'A' | 'B' | 'C' | 'D';

export interface Mp3Probe {
  case: BeatshiftCase;
  /** Le prove su cui si basa il verdetto, per poterlo spiegare. */
  evidence: {
    xing: boolean;
    lame: boolean;
    lameCrcOk: boolean | null;
    encoder: string | null;
    channelModeMatch: boolean | null;
  };
}

const BITRATE_MPEG1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
const BITRATE_MPEG2_L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];
/** Indice = campo versione dell'header (0 = MPEG 2.5, 2 = MPEG 2, 3 = MPEG 1). */
const SAMPLE_RATES: Record<number, number[]> = {
  3: [44100, 48000, 32000],
  2: [22050, 24000, 16000],
  0: [11025, 12000, 8000]
};

interface FrameHeader {
  offset: number;
  version: number;
  channelMode: number;
  bitrate: number;
  sampleRate: number;
  padding: number;
  length: number;
}

function syncsafe(b: Buffer, o: number): number {
  return (b[o] << 21) | (b[o + 1] << 14) | (b[o + 2] << 7) | b[o + 3];
}

/** Fine del tag ID3v2, cioè dove comincia l'audio. 0 se il tag non c'è. */
export function id3v2End(data: Buffer): number {
  if (data.length < 10 || data.toString('latin1', 0, 3) !== 'ID3') return 0;
  const footer = (data[5] & 0x10) !== 0 ? 10 : 0;
  return 10 + syncsafe(data, 6) + footer;
}

function parseHeader(data: Buffer, off: number): FrameHeader | null {
  if (off + 4 > data.length) return null;
  if (data[off] !== 0xff || (data[off + 1] & 0xe0) !== 0xe0) return null;
  const h = data.readUInt32BE(off);
  const version = (h >> 19) & 3;
  const layer = (h >> 17) & 3;
  const brIdx = (h >> 12) & 15;
  const srIdx = (h >> 10) & 3;
  if (version === 1 || layer !== 1 || brIdx === 0 || brIdx === 15 || srIdx === 3) return null;
  const sampleRate = SAMPLE_RATES[version][srIdx];
  const bitrate = (version === 3 ? BITRATE_MPEG1_L3 : BITRATE_MPEG2_L3)[brIdx] * 1000;
  const padding = (h >> 9) & 1;
  const length = Math.floor(((version === 3 ? 144 : 72) * bitrate) / sampleRate) + padding;
  return { offset: off, version, channelMode: (h >> 6) & 3, bitrate, sampleRate, padding, length };
}

/** Primo header MPEG Layer III valido dopo `start`. */
function firstFrame(data: Buffer, start: number): FrameHeader | null {
  const limit = Math.min(data.length - 4, start + 256 * 1024);
  for (let i = start; i <= limit; i++) {
    if (data[i] !== 0xff) continue;
    const h = parseHeader(data, i);
    if (h) return h;
  }
  return null;
}

/** Offset del frame Xing/Info dall'inizio del frame: dipende da versione e canali. */
function xingOffset(h: FrameHeader): number {
  const mono = h.channelMode === 3;
  if (h.version === 3) return 4 + (mono ? 17 : 32);
  return 4 + (mono ? 9 : 17);
}

/** CRC-16 del tag LAME: polinomio 0x8005 riflesso, valore iniziale 0. */
function crc16(buf: Buffer): number {
  let crc = 0;
  for (const byte of buf) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = crc & 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
  }
  return crc & 0xffff;
}

/* ------------------------------------------------- testo dei frame ID3v2 */

function decodeText(enc: number, b: Buffer): string {
  try {
    if (enc === 0) return b.toString('latin1');
    if (enc === 3) return b.toString('utf8');
    if (enc === 1) {
      if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) return swap16(b.subarray(2)).toString('utf16le');
      if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe) return b.subarray(2).toString('utf16le');
      return b.toString('utf16le');
    }
    if (enc === 2) return swap16(b).toString('utf16le');
  } catch {
    /* testo illeggibile: ignorato */
  }
  return '';
}

function swap16(b: Buffer): Buffer {
  const out = Buffer.from(b.subarray(0, b.length - (b.length % 2)));
  out.swap16();
  return out;
}

/**
 * Valori dei frame di testo (T***, compreso TXXX) del tag ID3v2.
 *
 * Servono per le firme degli encoder: `ffmpeg` scrive la propria versione in
 * TSSE ("Lavf58.20.100"), e alcuni negozi mettono il proprio nome in un frame
 * di testo. Sono questi i segnali che distinguono i casi ingannevoli.
 */
export function id3TextValues(data: Buffer): string[] {
  const end = id3v2End(data);
  if (end === 0) return [];
  const major = data[3];
  let tag = data.subarray(10, Math.min(end, data.length));
  if ((data[5] & 0x80) !== 0 && major < 4) {
    // Desincronizzazione a livello di tag: FF 00 → FF.
    const out: number[] = [];
    for (let i = 0; i < tag.length; i++) {
      out.push(tag[i]);
      if (tag[i] === 0xff && tag[i + 1] === 0x00) i++;
    }
    tag = Buffer.from(out);
  }
  const values: string[] = [];
  const idLen = major === 2 ? 3 : 4;
  const headLen = major === 2 ? 6 : 10;
  let o = 0;
  while (o + headLen <= tag.length) {
    const id = tag.toString('latin1', o, o + idLen);
    if (!/^[A-Z0-9]+$/.test(id)) break;
    const size =
      major === 2
        ? (tag[o + 3] << 16) | (tag[o + 4] << 8) | tag[o + 5]
        : major === 4
          ? syncsafe(tag, o + 4)
          : tag.readUInt32BE(o + 4);
    const body = tag.subarray(o + headLen, o + headLen + size);
    if (size <= 0 || body.length < size) break;
    if (id[0] === 'T' && body.length > 1) {
      const enc = body[0];
      let text = decodeText(enc, body.subarray(1));
      if (id === 'TXXX' || id === 'TXX') {
        // descrizione NUL, poi il valore
        const parts = text.split('\u0000').filter((p) => p !== '');
        text = parts.length > 1 ? parts.slice(1).join(' ') : (parts[0] ?? '');
      }
      for (const v of text.split('\u0000')) if (v) values.push(v);
    }
    o += headLen + size;
  }
  return values;
}

/* ------------------------------------------------------- classificazione */

/**
 * Classifica un MP3 a partire dai suoi primi byte.
 *
 * `data` deve contenere almeno il tag ID3v2 e i primi due frame audio: per un
 * file reale bastano i primi 512 KB.
 *
 * L'ordine delle regole conta ed è quello della specifica: prima le firme di
 * encoder note per ingannare (che vincono su tutto), poi la struttura.
 *
 * ⚠ La specifica ricava i segnali dall'output di un'utilità di analisi MP3, e
 * in tre punti ne eredita il comportamento esatto; qui lo si replica invece di
 * "correggerlo", perché i valori di spostamento sono stati misurati su QUEL
 * comportamento:
 *  - il tag LAME è la prima occorrenza di "LAME" nel primo frame, non una
 *    posizione calcolata;
 *  - il suo CRC si verifica sui primi 190 byte del frame, che è la posizione
 *    giusta per un MPEG-1 stereo e non per gli altri casi;
 *  - la correzione del channel mode cerca il primo byte di sincronismo senza
 *    validare l'header, e usa la geometria MPEG-1.
 */
export function classifyMp3(data: Buffer): Mp3Probe | null {
  const start = id3v2End(data);
  const frame = firstFrame(data, start);
  if (!frame) return null;
  const frameBytes = data.subarray(frame.offset, frame.offset + frame.length);

  const xo = xingOffset(frame);
  const head = frameBytes.toString('latin1', xo, xo + 4);
  const xing = head === 'Xing' || head === 'Info';

  const lamePos = frameBytes.indexOf('LAME', 0, 'latin1');
  const lame = lamePos >= 0;
  let lameCrcOk: boolean | null = null;
  let encoder: string | null = null;
  if (lame) {
    encoder = frameBytes.toString('latin1', lamePos, lamePos + 9).replace(/[\u0000\s]+$/, '');
    if (frameBytes.length >= 192) {
      lameCrcOk = crc16(frameBytes.subarray(0, 190)) === frameBytes.readUInt16BE(190);
    } else {
      lameCrcOk = false;
    }
  }

  const texts = id3TextValues(data);
  const corpus = [...texts, encoder ?? ''].join('\n');
  const has = (s: string) => corpus.includes(s);
  const beatport = texts.some((t) => t.startsWith('Beatport'));

  let c: BeatshiftCase;
  if (beatport || has('Lavf57.83.100')) c = 'C';
  else if (has('LAME3.99r') && has('Lavf56.30.100')) c = 'B';
  else if ((has('Lavf58.20.100') || has('Lavf57.71.100')) && !lame) c = 'D';
  else if ((has('Lavf58.20.100') || has('Lavf57.71.100')) && has('LAME3.100')) c = 'B';
  else if (!xing) c = 'A';
  else if (!lame) c = 'B';
  else if (lameCrcOk === false) c = 'C';
  else c = 'D';

  const match = channelModeMatch(data, start);
  if (c === 'B' && match === true) c = 'D';
  else if (c === 'D' && match === false) c = 'C';

  return { case: c, evidence: { xing, lame, lameCrcOk, encoder, channelModeMatch: match } };
}

/**
 * Il channel mode del frame Info coincide con quello del primo frame audio?
 *
 * Quando coincide, alcuni decoder scambiano il frame Info per audio e lo
 * suonano come 1152 campioni di silenzio: è ciò che separa il caso B dal D.
 * `null` se la domanda non ha risposta (nessun frame Info nella posizione
 * attesa, o geometria non MPEG-1).
 */
function channelModeMatch(data: Buffer, start: number): boolean | null {
  const buf = data.subarray(start, start + 2200);
  let i = 0;
  while (i + 4 <= buf.length && !(buf[i] === 0xff && (buf[i + 1] & 0xe0) === 0xe0)) i++;
  if (i + 4 > buf.length) return null;
  const h = buf.readUInt32BE(i);
  const ch1 = (h >> 6) & 3;
  const xo = i + 4 + (ch1 === 3 ? 17 : 32);
  const tag = buf.toString('latin1', xo, xo + 4);
  if (tag !== 'Xing' && tag !== 'Info') return null;
  const version = (h >> 19) & 3;
  const bitrate = BITRATE_MPEG1_L3[(h >> 12) & 15] * 1000;
  const srIdx = (h >> 10) & 3;
  if (bitrate === 0 || srIdx === 3 || !(version in SAMPLE_RATES)) return null;
  const size = Math.floor((144 * bitrate) / SAMPLE_RATES[version][srIdx]) + ((h >> 9) & 1);
  const j = i + size;
  if (j + 4 > buf.length) return null;
  const ch2 = (buf.readUInt32BE(j) >> 6) & 3;
  return ch1 === ch2;
}

/* ================================================= 2. matrice degli scarti */

/** Software tra cui si sposta un cue, nella granularità che conta per il decoder. */
export type BeatshiftApp = 'rekordbox' | 'traktor' | 'serato' | 'virtualdj' | 'engine' | 'djay';

/**
 * Da `tracks.source` al software. `null` per origini che non sono un software
 * DJ (analisi propria, import di file): per quelle non si sposta niente.
 */
export function appFromSource(source: string | null | undefined): BeatshiftApp | null {
  switch ((source ?? '').toLowerCase()) {
    case 'masterdb':
    case 'rekordbox':
    case 'rekordbox-xml':
    case 'rekordbox-usb':
    case 'usb':
      return 'rekordbox';
    case 'traktor':
      return 'traktor';
    case 'serato':
    case 'serato4':
      return 'serato';
    case 'virtualdj':
      return 'virtualdj';
    case 'engine':
      return 'engine';
    case 'djay':
      return 'djay';
    default:
      return null;
  }
}

export type AudioKind = 'mp3' | 'mp4' | 'other';

export function audioKindOf(path: string | null | undefined): AudioKind {
  const p = (path ?? '').toLowerCase();
  if (p.endsWith('.mp3')) return 'mp3';
  if (p.endsWith('.m4a') || p.endsWith('.mp4') || p.endsWith('.aac')) return 'mp4';
  return 'other';
}

/** 26 ms: casi B e C. */
const FRAME_HALF = 0.026;
/** 51 ms: un frame MP3 intero più il ritardo del decoder (caso A). */
const FRAME_FULL = 0.051;
/** 9 ms: correzione fra Traktor/VirtualDJ e Rekordbox. */
const SMALL = 0.009;
/** Latenza di decodifica MP3 del software d'origine. */
const DECODER_LATENCY: Partial<Record<BeatshiftApp, number>> = {
  rekordbox: 0.051,
  traktor: 0.051,
  serato: 0.046
};

/**
 * Dal tempo del software d'origine a un tempo di riferimento comune.
 */
function toReference(origin: BeatshiftApp, kind: AudioKind, c: BeatshiftCase | null): number {
  const lat = DECODER_LATENCY[origin];
  if (lat === undefined) return 0;
  let h = 0;
  if (kind === 'mp3') h -= lat;
  if (c === 'A') h += FRAME_FULL;
  return h;
}

/**
 * Dal tempo di riferimento al software di destinazione, sapendo da dove viene
 * il cue (le correzioni dipendono dalla coppia, non dal solo destinatario).
 */
function fromReference(
  target: BeatshiftApp,
  origin: BeatshiftApp,
  kind: AudioKind,
  c: BeatshiftCase | null
): number {
  let h = 0;
  if (kind === 'mp3') {
    if (target === 'rekordbox') h += DECODER_LATENCY.rekordbox!;
    else if (target === 'traktor') h += DECODER_LATENCY.traktor!;
    else if (target === 'serato') h += DECODER_LATENCY.serato!;
  }
  if (kind === 'mp3' || kind === 'mp4') {
    if (target === 'traktor' && origin === 'rekordbox') h += SMALL;
    if (target === 'virtualdj' && (origin === 'rekordbox' || origin === 'traktor')) h -= SMALL;
  }
  if (c === null) return h;

  switch (target) {
    case 'rekordbox':
      if (origin === 'traktor' || origin === 'virtualdj' || origin === 'rekordbox') {
        if (c === 'A') h -= FRAME_FULL;
        else if (c === 'B' || c === 'C') h -= FRAME_HALF;
      } else if (origin === 'serato') {
        if (c === 'A') h -= FRAME_FULL;
        else if (c === 'B') h -= 0.021;
        else if (c === 'C') h -= FRAME_HALF;
      } else if (origin === 'engine') {
        if (c === 'A') h -= FRAME_FULL;
        else if (c === 'B') h -= FRAME_HALF;
        else if (c === 'C') h -= 0.02;
      }
      break;
    case 'traktor':
      if (origin === 'traktor') {
        if (c === 'A') h -= FRAME_FULL;
      } else if (origin === 'rekordbox') {
        if (c === 'A') h -= FRAME_FULL;
        else if (c === 'B') h -= 0.001;
        else if (c === 'C') h -= 0.002;
      } else if (origin === 'serato') {
        if (c === 'A') h -= FRAME_FULL;
        else if (c === 'B') h -= FRAME_HALF;
      } else if (origin === 'engine') {
        if (c === 'A') h -= FRAME_FULL;
      }
      break;
    case 'serato':
      if (origin !== 'djay' && c === 'A') h -= FRAME_FULL;
      break;
    case 'virtualdj':
      if (origin === 'serato' && c === 'B') h -= FRAME_HALF;
      break;
    default:
      break;
  }
  return h;
}

export interface BeatshiftInput {
  origin: BeatshiftApp | null;
  target: BeatshiftApp | null;
  kind: AudioKind;
  /** Caso del file; obbligatorio per gli MP3, ignorato per gli altri formati. */
  mp3Case: BeatshiftCase | null;
}

/**
 * Di quanti SECONDI spostare un cue che va da `origin` a `target`.
 *
 * Restituisce 0 — cioè non tocca niente — in tre casi, tutti per prudenza:
 *  - origine o destinazione sconosciute;
 *  - origine e destinazione coincidono: un cue che torna al software da cui è
 *    partito deve restare dov'era, qualunque cosa dica la tabella;
 *  - MP3 di cui non si conosce il caso: senza il caso la correzione sarebbe
 *    parziale, e una correzione parziale sposta il cue nel posto sbagliato con
 *    l'aria di averlo sistemato.
 */
export function beatshiftSeconds(i: BeatshiftInput): number {
  if (!i.origin || !i.target || i.origin === i.target) return 0;
  if (i.kind === 'mp3' && i.mp3Case === null) return 0;
  const c = i.kind === 'mp3' ? i.mp3Case : null;
  const s = toReference(i.origin, i.kind, c) + fromReference(i.target, i.origin, i.kind, c);
  // Arrotondamento al decimo di millisecondo: le costanti sono in millisecondi
  // interi, e la somma in virgola mobile non deve produrre code tipo 0.0249999.
  return Math.round(s * 10000) / 10000;
}
