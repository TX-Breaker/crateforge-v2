import { deflateSync, inflateSync } from 'zlib';

/**
 * Codec dei blob PerformanceData di Engine DJ.
 *
 * Struttura misurata byte-per-byte su una libreria Engine 5.0 reale (schema
 * 3.0.2, 114 tracce, 2 con 8 hot cue e 8 loop impostati a mano):
 *
 *  quickCues — framing [uint32 BE lunghezza decompressa][stream zlib]
 *      payload: int64 BE numero slot, poi per ogni slot
 *               uint8 lunghezza etichetta | etichetta UTF-8 (non terminata)
 *               double BE posizione in SAMPLE | 4 byte ARGB
 *      coda: 17 byte = double BE main cue "adjusted" | uint8 flag | double BE
 *            main cue di default
 *      slot vuoto: etichetta di lunghezza 0, posizione -1.0, colore 00000000
 *
 *  loops — NON compresso e NON framed, e in LITTLE-endian (al contrario dei
 *      cue): int64 LE numero slot, poi per ogni slot
 *      uint8 lunghezza etichetta | etichetta | double LE inizio in sample |
 *      double LE fine | uint8 inizio impostato | uint8 fine impostata |
 *      4 byte ARGB
 *
 * Le posizioni sono in SAMPLE, quindi la conversione in millisecondi richiede
 * la sample rate del brano (double BE all'inizio di `trackData`): usare 44100
 * fisso sbaglierebbe di ~9% su un file a 48 kHz.
 *
 * Il byte alpha vale 0xFF su tutti gli slot pieni reali (16 cue e 16 loop
 * misurati) e 0x00 su quelli vuoti: è il flag "slot occupato".
 */

export const ENGINE_SLOTS = 8;
/** Posizione degli slot vuoti in Engine (double -1.0). */
const EMPTY_POS = -1;

export interface EngineCueSlot {
  label: string;
  positionSamples: number;
  /** "#RRGGBB" */
  color: string;
}

export interface EngineLoopSlot {
  label: string;
  startSamples: number;
  endSamples: number;
  color: string;
}

export interface EngineQuickCues {
  slots: (EngineCueSlot | null)[];
  /** Coda di 17 byte: va conservata così com'è quando si riscrive. */
  trailer: Buffer;
}

/** Palette di fabbrica dei pad Engine (identica su cue e loop, misurata). */
export const ENGINE_PAD_COLORS = [
  '#F4D338',
  '#EF8130',
  '#AA55C4',
  '#CE3239',
  '#86C64B',
  '#20C670',
  '#00A8A9',
  '#1571E2'
];

function hexToRgb(hex: string | null, fallback: string): [number, number, number] {
  const h = hex && /^#[0-9a-f]{6}$/i.test(hex) ? hex : fallback;
  return [
    parseInt(h.slice(1, 3), 16),
    parseInt(h.slice(3, 5), 16),
    parseInt(h.slice(5, 7), 16)
  ];
}

function rgbToHex(r: number, g: number, b: number): string {
  const h = (n: number) => n.toString(16).padStart(2, '0');
  return ('#' + h(r) + h(g) + h(b)).toUpperCase();
}

/**
 * Etichetta troncata a 255 BYTE (la lunghezza è un uint8) senza spezzare una
 * sequenza UTF-8 a metà: un accento tagliato produrrebbe byte non validi.
 */
function encodeLabel(label: string): Buffer {
  let buf = Buffer.from(label, 'utf8');
  if (buf.length > 255) {
    buf = buf.subarray(0, 255);
    while (buf.length > 0 && (buf[buf.length - 1] & 0xc0) === 0x80) {
      buf = buf.subarray(0, buf.length - 1);
    }
    // Se l'ultimo byte apre una sequenza multi-byte troncata, toglilo.
    if (buf.length > 0 && (buf[buf.length - 1] & 0x80) !== 0) {
      buf = buf.subarray(0, buf.length - 1);
    }
  }
  return buf;
}

/* ------------------------------------------------------------ framing zlib */

export function unframeZlib(blob: Buffer): Buffer {
  return inflateSync(blob.subarray(4));
}

/**
 * Aggiunge il framing di Engine: 4 byte big-endian con la lunghezza dei dati
 * DECOMPRESSI, poi lo stream zlib. Il framing coincide con qCompress di Qt, e
 * Engine è un'app Qt: un prefisso sbagliato può far rifiutare il blob, quindi
 * scriviamo sempre il valore esatto.
 */
export function frameZlib(payload: Buffer): Buffer {
  const prefix = Buffer.alloc(4);
  prefix.writeUInt32BE(payload.length, 0);
  // Livello 6 (Z_DEFAULT_COMPRESSION): è quello che Engine stesso usa, come
  // mostra l'header 78 9c su tutti i blob reali.
  return Buffer.concat([prefix, deflateSync(payload, { level: 6 })]);
}

/* --------------------------------------------------------------- quickCues */

export function decodeQuickCues(payload: Buffer): EngineQuickCues {
  const count = Number(payload.readBigInt64BE(0));
  let off = 8;
  const slots: (EngineCueSlot | null)[] = [];
  for (let i = 0; i < count; i++) {
    const len = payload.readUInt8(off);
    off += 1;
    const label = len ? payload.subarray(off, off + len).toString('utf8') : '';
    off += len;
    const positionSamples = payload.readDoubleBE(off);
    off += 8;
    const [a, r, g, b] = [payload[off], payload[off + 1], payload[off + 2], payload[off + 3]];
    off += 4;
    slots.push(a !== 0 && positionSamples >= 0 ? { label, positionSamples, color: rgbToHex(r, g, b) } : null);
  }
  return { slots, trailer: payload.subarray(off) };
}

export function encodeQuickCues(qc: EngineQuickCues): Buffer {
  const parts: Buffer[] = [];
  const head = Buffer.alloc(8);
  head.writeBigInt64BE(BigInt(qc.slots.length), 0);
  parts.push(head);
  for (const slot of qc.slots) {
    const label = slot ? encodeLabel(slot.label) : Buffer.alloc(0);
    const b = Buffer.alloc(1 + label.length + 8 + 4);
    let o = 0;
    b.writeUInt8(label.length, o);
    o += 1;
    label.copy(b, o);
    o += label.length;
    b.writeDoubleBE(slot ? slot.positionSamples : EMPTY_POS, o);
    o += 8;
    if (slot) {
      const [r, g, bl] = hexToRgb(slot.color, '#FFFFFF');
      b.writeUInt8(0xff, o); // alpha: slot occupato
      b.writeUInt8(r, o + 1);
      b.writeUInt8(g, o + 2);
      b.writeUInt8(bl, o + 3);
    } else {
      b.writeUInt32BE(0, o);
    }
    parts.push(b);
  }
  parts.push(qc.trailer);
  return Buffer.concat(parts);
}

/** Coda di default: nessun main cue impostato (valore osservato su 111 tracce). */
export function defaultTrailer(): Buffer {
  const t = Buffer.alloc(17);
  t.writeDoubleBE(-1, 0);
  t.writeUInt8(0, 8);
  t.writeDoubleBE(-1, 9);
  return t;
}

/* ------------------------------------------------------------------- loops */

export function decodeLoops(payload: Buffer): (EngineLoopSlot | null)[] {
  const count = Number(payload.readBigInt64LE(0));
  let off = 8;
  const out: (EngineLoopSlot | null)[] = [];
  for (let i = 0; i < count; i++) {
    const len = payload.readUInt8(off);
    off += 1;
    const label = len ? payload.subarray(off, off + len).toString('utf8') : '';
    off += len;
    const startSamples = payload.readDoubleLE(off);
    off += 8;
    const endSamples = payload.readDoubleLE(off);
    off += 8;
    const isStart = payload.readUInt8(off);
    off += 1;
    const isEnd = payload.readUInt8(off);
    off += 1;
    const [a, r, g, b] = [payload[off], payload[off + 1], payload[off + 2], payload[off + 3]];
    off += 4;
    out.push(
      isStart && isEnd && a !== 0 ? { label, startSamples, endSamples, color: rgbToHex(r, g, b) } : null
    );
  }
  return out;
}

export function encodeLoops(loops: (EngineLoopSlot | null)[]): Buffer {
  const parts: Buffer[] = [];
  const head = Buffer.alloc(8);
  head.writeBigInt64LE(BigInt(loops.length), 0);
  parts.push(head);
  for (const l of loops) {
    const label = l ? encodeLabel(l.label) : Buffer.alloc(0);
    const b = Buffer.alloc(1 + label.length + 8 + 8 + 1 + 1 + 4);
    let o = 0;
    b.writeUInt8(label.length, o);
    o += 1;
    label.copy(b, o);
    o += label.length;
    b.writeDoubleLE(l ? l.startSamples : EMPTY_POS, o);
    o += 8;
    b.writeDoubleLE(l ? l.endSamples : EMPTY_POS, o);
    o += 8;
    b.writeUInt8(l ? 1 : 0, o);
    o += 1;
    b.writeUInt8(l ? 1 : 0, o);
    o += 1;
    if (l) {
      const [r, g, bl] = hexToRgb(l.color, '#FFFFFF');
      b.writeUInt8(0xff, o);
      b.writeUInt8(r, o + 1);
      b.writeUInt8(g, o + 2);
      b.writeUInt8(bl, o + 3);
    } else {
      b.writeUInt32LE(0, o);
    }
    parts.push(b);
  }
  return Buffer.concat(parts);
}

/* -------------------------------------------------------------- beatData  */

/**
 * Intestazione di `beatData` — la sola parte del blob che sia documentata.
 *
 * ⚠ Big-endian, e i due valori sono `double` IEEE-754, non interi. Letti come
 * uint32 il sample rate diventa 1088421504: un numero abbastanza plausibile da
 * non far scattare nessun controllo, e abbastanza sbagliato da rovinare ogni
 * conversione di posizione.
 *
 * Il corpo che segue — i marker veri e propri — NON è documentato, e questo
 * modulo non lo interpreta. Vedi `decodeBeatDataHeader` per il perché.
 */
export interface EngineBeatDataHeader {
  sampleRate: number;
  totalSamples: number;
  /** Byte di flag dopo i due double. Significato ignoto; conservato per il round-trip. */
  flag: number;
  /** Byte del blob che restano non interpretati. */
  unparsedBytes: number;
}

/** Il rapporto campioni/sample-rate deve dare una durata di brano credibile. */
const MIN_TRACK_SECONDS = 1;
const MAX_TRACK_SECONDS = 4 * 60 * 60;

/**
 * Legge l'intestazione di `beatData`, e SOLO quella.
 *
 * ⚠ Perché non anche i marker. La specifica dichiara il corpo del blob come non
 * verificato, e l'ispezione di una libreria reale non lo ha chiarito: la
 * struttura sembra fatta di record da 56 byte con posizione in `double`
 * little-endian e numero di battito in `int64` little-endian, ma ricavando il
 * tempo dai due marker di una traccia a 71 BPM ne risultano 72,59 — un errore
 * del 2%. Su una griglia, il 2% non è un'imprecisione: è un downbeat che a metà
 * brano è fuori di mezza battuta.
 *
 * Una griglia sbagliata è peggio di una griglia assente, perché sembra giusta.
 * Finché il layout non è confermato su più versioni di Engine, da qui esce solo
 * ciò che è certo — e chi legge sa esattamente quanto resta fuori.
 */
export function decodeBeatDataHeader(payload: Buffer): EngineBeatDataHeader | null {
  if (payload.length < 17) return null;
  const sampleRate = payload.readDoubleBE(0);
  const totalSamples = payload.readDoubleBE(8);

  // Controlli di plausibilità: servono a distinguere un blob valido da uno di
  // una versione con un layout diverso, che altrimenti darebbe numeri assurdi
  // trattati come veri.
  if (!Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 192000) return null;
  if (!Number.isFinite(totalSamples) || totalSamples <= 0) return null;
  const seconds = totalSamples / sampleRate;
  if (seconds < MIN_TRACK_SECONDS || seconds > MAX_TRACK_SECONDS) return null;

  return {
    sampleRate,
    totalSamples,
    flag: payload[16],
    unparsedBytes: payload.length - 17
  };
}

/* ------------------------------------------------------------- trackData  */

/**
 * `trackData` minimo: serve perché la sample rate del brano vive qui, ed è
 * quella che permette di riconvertire le posizioni in millisecondi.
 * Layout misurato: double BE sample rate | int64 BE totale sample |
 * int32 BE key (-1 = sconosciuta, la ricalcola Engine) | 3 double BE loudness.
 * I 24 byte finali sono zero su tutte le tracce reali osservate.
 */
export function encodeTrackData(sampleRate: number, totalSamples: number): Buffer {
  const b = Buffer.alloc(68);
  b.writeDoubleBE(sampleRate, 0);
  b.writeBigInt64BE(BigInt(Math.max(0, Math.round(totalSamples))), 8);
  b.writeInt32BE(-1, 16); // key sconosciuta: Engine la ricalcola all'analisi
  return b;
}

export const msToSamples = (ms: number, sampleRate: number): number => (ms / 1000) * sampleRate;
export const samplesToMs = (samples: number, sampleRate: number): number =>
  (samples / sampleRate) * 1000;
