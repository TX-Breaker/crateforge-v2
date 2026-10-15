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
 * `beatData` — intestazione e griglia.
 *
 * Layout (payload già decompresso, verificato su 114 tracce reali di Engine
 * 5.0, schema 3.0.2):
 *
 *   double BE  sample rate
 *   double BE  numero di campioni
 *   uint8      flag (significato ignoto, conservato)
 *   uint64 BE  numero di marker della griglia DI DEFAULT, poi i marker
 *   uint64 BE  numero di marker della griglia CORRETTA, poi i marker
 *   coda       9 byte su tutte le tracce osservate, conservati
 *
 *   marker (24 byte, LITTLE-endian, al contrario dell'intestazione):
 *     double LE  posizione in campioni
 *     int64  LE  indice del battito
 *     uint32 LE  battiti fino al marker successivo
 *     4 byte     non interpretati
 *
 * ⚠ Una versione precedente di questo modulo leggeva SOLO l'intestazione e
 * dichiarava i marker illeggibili: li aveva interpretati come record da 56 byte,
 * ne ricavava 72,59 BPM su un brano da 71, e giustamente si rifiutava di usare
 * una griglia sbagliata del 2%. L'errore era nella dimensione del record, non
 * nel formato. Con marker da 24 byte il tempo ricavato coincide con
 * `bpmAnalyzed` su tutte le 114 tracce, con scarto massimo zero.
 *
 * L'endianness mista non è un refuso: intestazione big-endian, marker
 * little-endian. Per questo i controlli di plausibilità sotto sono espliciti:
 * un marker letto con l'endianness sbagliata dà numeri assurdi ma finiti.
 */
export interface EngineBeatMarker {
  positionSamples: number;
  beatIndex: number;
  beatsToNext: number;
}

export interface EngineBeatDataHeader {
  sampleRate: number;
  totalSamples: number;
  /** Byte di flag dopo i due double. Significato ignoto; conservato per il round-trip. */
  flag: number;
  /** Byte del blob che restano non interpretati. */
  unparsedBytes: number;
}

export interface EngineBeatData extends EngineBeatDataHeader {
  defaultGrid: EngineBeatMarker[];
  /** La griglia che l'utente vede in Engine: è quella da usare. */
  adjustedGrid: EngineBeatMarker[];
}

/** Il rapporto campioni/sample-rate deve dare una durata di brano credibile. */
const MIN_TRACK_SECONDS = 1;
const MAX_TRACK_SECONDS = 4 * 60 * 60;
const MARKER_BYTES = 24;
/** Oltre questo valore un indice di battito non è un dato, è un disallineamento. */
const MAX_PLAUSIBLE_BEATS = 100_000;
const MAX_MARKERS = 10_000;

function readHeader(payload: Buffer): EngineBeatDataHeader | null {
  if (payload.length < 17) return null;
  const sampleRate = payload.readDoubleBE(0);
  const totalSamples = payload.readDoubleBE(8);
  // Controlli di plausibilità: distinguono un blob valido da uno di una
  // versione con un layout diverso, che altrimenti darebbe numeri assurdi
  // trattati come veri.
  if (!Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 192000) return null;
  if (!Number.isFinite(totalSamples) || totalSamples <= 0) return null;
  const seconds = totalSamples / sampleRate;
  if (seconds < MIN_TRACK_SECONDS || seconds > MAX_TRACK_SECONDS) return null;
  return { sampleRate, totalSamples, flag: payload[16], unparsedBytes: payload.length - 17 };
}

function readGrid(payload: Buffer, start: number): { markers: EngineBeatMarker[]; next: number } | null {
  let off = start;
  if (off + 8 > payload.length) return null;
  const count = Number(payload.readBigUInt64BE(off));
  off += 8;
  if (count > MAX_MARKERS || off + count * MARKER_BYTES > payload.length) return null;
  const markers: EngineBeatMarker[] = [];
  for (let i = 0; i < count; i++) {
    const positionSamples = payload.readDoubleLE(off);
    const beatIndex = Number(payload.readBigInt64LE(off + 8));
    const beatsToNext = payload.readUInt32LE(off + 16);
    off += MARKER_BYTES;
    if (!Number.isFinite(positionSamples)) return null;
    if (Math.abs(beatIndex) > MAX_PLAUSIBLE_BEATS || beatsToNext > MAX_PLAUSIBLE_BEATS) return null;
    markers.push({ positionSamples, beatIndex, beatsToNext });
  }
  return { markers, next: off };
}

/** Solo l'intestazione: basta quando serve la sample rate. */
export function decodeBeatDataHeader(payload: Buffer): EngineBeatDataHeader | null {
  return readHeader(payload);
}

/**
 * Intestazione e due griglie. `null` se il blob non rispetta il layout: meglio
 * nessuna griglia che una griglia letta di traverso.
 */
export function decodeBeatData(payload: Buffer): EngineBeatData | null {
  const header = readHeader(payload);
  if (!header) return null;
  const def = readGrid(payload, 17);
  if (!def) return null;
  const adj = readGrid(payload, def.next);
  if (!adj) return null;
  return {
    ...header,
    unparsedBytes: payload.length - adj.next,
    defaultGrid: def.markers,
    adjustedGrid: adj.markers
  };
}

export interface ConstantBeatgrid {
  bpm: number;
  /** Istante del battito di indice 0, il primo downbeat, in millisecondi. */
  anchorMs: number;
  /**
   * true se la griglia ha più segmenti con tempo diverso. Il modello interno
   * rappresenta solo griglie a BPM costante: in quel caso bpm e ancora vengono
   * dal primo segmento, e chi legge deve saperlo.
   */
  variable: boolean;
}

/** Scarto ammesso fra i tempi di due segmenti perché la griglia sia "costante". */
const CONSTANT_TEMPO_TOLERANCE_BPM = 0.01;

/**
 * Griglia a BPM costante ricavata dai marker.
 *
 * ⚠ L'ancora è il battito di INDICE 0, non il primo marker. Engine mette il
 * primo marker a un indice negativo (-4 su tutte le tracce reali), cioè prima
 * dell'inizio del file: usarlo come ancora darebbe un istante negativo, e un
 * writer che lo azzerasse sposterebbe tutta la griglia di quattro battiti.
 */
export function beatgridFromMarkers(
  markers: EngineBeatMarker[],
  sampleRate: number
): ConstantBeatgrid | null {
  if (markers.length < 2 || !(sampleRate > 0)) return null;
  const tempi: number[] = [];
  for (let i = 0; i + 1 < markers.length; i++) {
    const a = markers[i];
    const b = markers[i + 1];
    const beats = b.beatIndex - a.beatIndex;
    const seconds = (b.positionSamples - a.positionSamples) / sampleRate;
    if (beats <= 0 || seconds <= 0) return null;
    tempi.push((beats / seconds) * 60);
  }
  const bpm = tempi[0];
  if (!(bpm > 20 && bpm < 400)) return null;
  const variable = tempi.some((t) => Math.abs(t - bpm) > CONSTANT_TEMPO_TOLERANCE_BPM);
  const first = markers[0];
  const secondsPerBeat = 60 / bpm;
  let anchorS = first.positionSamples / sampleRate - first.beatIndex * secondsPerBeat;
  // Un'ancora prima dell'inizio del brano si porta avanti di battute intere,
  // così resta un downbeat.
  while (anchorS < 0) anchorS += 4 * secondsPerBeat;
  return { bpm, anchorMs: anchorS * 1000, variable };
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
