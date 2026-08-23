/**
 * djay Pro — i due formati di payload della colonna `data`.
 *
 * ⚠ Il database di djay non ha una tabella di tracce. È un archivio
 * chiave-valore (`database2`) e i dati veri stanno in un blob, che può essere
 * di DUE formati diversi:
 *
 *   - **binary plist** (NSKeyedArchiver), riconosciuto dal magic `bplist`:
 *     è la roba importata dall'ecosistema Apple;
 *   - **formato proprietario**, header fisso di 20 byte e poi il byte `0x2B`.
 *
 * In una libreria reale convivono. Un lettore che ne gestisca uno solo importa
 * metà catalogo e non se ne accorge.
 *
 * ⚠⚠ STATO DI QUESTO MODULO: scritto sulla specifica, verificato solo contro
 * fixture sintetiche costruite dallo stesso encoder documentato. **Non è mai
 * stato eseguito su un `MediaLibrary.db` reale**, perché djay non è installato
 * sulla macchina di sviluppo. Finché non lo sarà, va trattato come plausibile e
 * non come collaudato: è per questo che il lettore raccoglie gli errori per
 * riga invece di far fallire l'import.
 */

/* ---------------------------------------------------------------- costanti */

/** I 22 tipi del formato proprietario. */
export const DJAY_TYPE = {
  NULL: 0,
  POINTER_DATE: 2,
  POINTER_STRING: 5,
  STRING: 8,
  ARRAY_CLASS: 11,
  BOOLEAN_TRUE: 13,
  BOOLEAN_FALSE: 14,
  NUMBER_N: 15,
  UINT16: 16,
  UINT32: 17,
  UINT64: 18,
  FLOAT: 19,
  DOUBLE: 20,
  BINARY: 21,
  UINT32_SKIP: 24,
  ARRAY_STRING: 27,
  URI: 33,
  CLASS: 43, // 0x2B
  NUMBER_1: 45,
  NUMBER_0: 46,
  DATE: 48
} as const;

/** Insiemi di tipi che denotano un array a dimensione fissa. */
export const DJAY_ARRAY_FIXEDSIZE = [27, 12, 10, 11, 26];

/** `"FAST"` — sta dentro i 20 byte di intestazione. */
export const DJAY_HEADER_MAGIC = 0x54534146;
export const DJAY_HEADER_SIZE = 20;
export const BPLIST_MAGIC = 'bplist';

/** Segnaposto per i blocchi binari, che non vengono decodificati. */
export const SKIPPED_BINARY = '<< skipped binary data >>';

export type DjayValue =
  | string
  | number
  | boolean
  | null
  | DjayValue[]
  | { [k: string]: DjayValue };

export type PayloadKind = 'bplist' | 'djay' | 'unknown';

/** Quale dei due formati è questo blob. */
export function detectPayloadKind(buf: Buffer): PayloadKind {
  if (buf.length >= 6 && buf.subarray(0, 6).toString('latin1') === BPLIST_MAGIC) return 'bplist';
  if (buf.length > DJAY_HEADER_SIZE && buf[DJAY_HEADER_SIZE] === DJAY_TYPE.CLASS) return 'djay';
  return 'unknown';
}

/* -------------------------------------------------- formato proprietario */

class DjayReader {
  private offset = DJAY_HEADER_SIZE;

  constructor(private readonly data: Buffer) {}

  /** Allineamento a blocchi di `n` byte, come fa il formato. */
  private alignTo(n: number): void {
    const rest = this.offset % n;
    if (rest !== 0) this.offset += n - rest;
  }

  private readU32Block(): number {
    this.alignTo(4);
    if (this.offset + 4 > this.data.length) throw new Error('payload troncato');
    const v = this.data.readUInt32BE(this.offset);
    this.offset += 4;
    return v;
  }

  private nextType(): number {
    if (this.offset >= this.data.length) throw new Error('payload troncato');
    return this.data[this.offset++];
  }

  /** Legge tipo e valore dalla posizione corrente. È l'ingresso del parser. */
  root(): DjayValue {
    return this.value(this.nextType());
  }

  private readCString(): string {
    const end = this.data.indexOf(0, this.offset);
    const stop = end === -1 ? this.data.length : end;
    const s = this.data.subarray(this.offset, stop).toString('utf8');
    this.offset = stop + 1;
    return s;
  }

  /** Un valore, dal suo tipo. Ricorsivo. */
  value(type: number): DjayValue {
    switch (type) {
      case DJAY_TYPE.NULL:
        return null;
      case DJAY_TYPE.BOOLEAN_TRUE:
        return true;
      case DJAY_TYPE.BOOLEAN_FALSE:
        return false;
      /* ⚠ Valori IMMEDIATI: il tipo stesso È il numero, non c'è payload che
         segue. Chi legge un byte di dati dopo questi tre disallinea tutto il
         resto del blob. */
      case DJAY_TYPE.NUMBER_0:
        return 0;
      case DJAY_TYPE.NUMBER_1:
        return 1;
      case DJAY_TYPE.NUMBER_N:
        return this.readU32Block();

      case DJAY_TYPE.STRING:
      case DJAY_TYPE.URI:
      case DJAY_TYPE.POINTER_STRING:
        return this.readCString();

      case DJAY_TYPE.UINT16: {
        const v = this.data.readUInt16BE(this.offset);
        this.offset += 2;
        return v;
      }
      case DJAY_TYPE.UINT32:
        return this.readU32Block();
      case DJAY_TYPE.UINT64: {
        this.alignTo(4);
        const v = Number(this.data.readBigUInt64BE(this.offset));
        this.offset += 8;
        return v;
      }
      case DJAY_TYPE.FLOAT: {
        this.alignTo(4);
        const v = this.data.readFloatBE(this.offset);
        this.offset += 4;
        return v;
      }
      case DJAY_TYPE.DOUBLE:
      case DJAY_TYPE.DATE:
      case DJAY_TYPE.POINTER_DATE: {
        this.alignTo(4);
        const v = this.data.readDoubleBE(this.offset);
        this.offset += 8;
        return v;
      }

      case DJAY_TYPE.BINARY: {
        /* I blob non si decodificano: è dove stanno waveform e dati di analisi,
           il cui formato non è documentato da nessuna parte. Si salta la
           lunghezza dichiarata e si prosegue, invece di fermare tutto. */
        const len = this.readU32Block();
        this.offset += len;
        this.alignTo(4);
        return SKIPPED_BINARY;
      }

      case DJAY_TYPE.CLASS:
        return this.classObject();

      case DJAY_TYPE.UINT32_SKIP:
      case DJAY_TYPE.ARRAY_STRING:
      case DJAY_TYPE.ARRAY_CLASS:
        return this.array(type);

      default:
        throw new Error(`tipo djay sconosciuto: ${type}`);
    }
  }

  /**
   * Oggetto tipizzato.
   *
   * ⚠ DUE PARTICOLARITÀ CHE INVERTONO L'INTUIZIONE, e vanno rispettate
   * entrambe o l'albero risultante è irriconoscibile:
   *
   *  1. Nelle coppie il **valore precede la chiave**. Leggere nell'ordine
   *     naturale non produce un errore di parsing: produce un oggetto in cui
   *     chiavi e valori sono scambiati, e il bug si manifesta come metadati
   *     assurdi molto più a valle.
   *  2. La lista dei campi finisce con un **byte nullo**, non con un conteggio.
   *     Non si può né pre-allocare né saltare la lista senza leggerla tutta.
   */
  private classObject(): { [k: string]: DjayValue } {
    const className = String(this.value(this.nextType()));
    const tags: { [k: string]: DjayValue } = { __class: className };

    for (;;) {
      if (this.offset >= this.data.length - 1) break;
      const value = this.value(this.nextType());
      if (this.offset >= this.data.length) break;
      const key = this.value(this.nextType());
      tags[String(key)] = value;
      if (this.offset >= this.data.length - 1) break;
      if (this.data[this.offset] === 0) break; // terminatore della lista
    }
    this.offset += 1;
    return tags;
  }

  /** Array. Il conteggio precede gli elementi; per `UINT32_SKIP` sono record. */
  private array(type: number): DjayValue[] {
    const count = this.readU32Block();
    const out: DjayValue[] = [];
    if (count > this.data.length) throw new Error('conteggio array non plausibile');

    for (let i = 0; i < count; i++) {
      if (type === DJAY_TYPE.UINT32_SKIP) {
        this.offset += 1;
        this.alignTo(4);
        const fields = this.readU32Block();
        const rec: { [k: string]: DjayValue } = {};
        for (let k = 0; k < fields; k++) {
          // Anche qui: prima il valore, poi la chiave.
          const v = this.value(this.nextType());
          const key = this.value(this.nextType());
          rec[String(key)] = v;
        }
        out.push(rec);
      } else {
        out.push(this.value(this.nextType()));
      }
    }
    return out;
  }
}

/** Deserializza un payload nel formato proprietario di djay. */
export function parseDjayPayload(buf: Buffer): DjayValue {
  if (buf.length <= DJAY_HEADER_SIZE) throw new Error('payload più corto dell’intestazione');
  if (buf[DJAY_HEADER_SIZE] !== DJAY_TYPE.CLASS) {
    throw new Error(`atteso 0x2B dopo i ${DJAY_HEADER_SIZE} byte di intestazione`);
  }
  /* Il byte dopo l'intestazione è già stato riconosciuto come CLASS, ma va
     comunque CONSUMATO: leggerne il valore senza avanzare farebbe interpretare
     lo stesso byte anche come tipo del nome della classe. */
  return new DjayReader(buf).root();
}

/**
 * Codifica di una stringa, come la produce djay.
 *
 * ⚠ La normalizzazione **NFC** non è un dettaglio estetico: i titoli con
 * accenti provenienti da macOS arrivano tipicamente in NFD, e senza
 * normalizzare due stringhe visivamente identiche non collidono mai.
 */
export function encodeDjayString(s: string): Buffer {
  return Buffer.concat([
    Buffer.from([DJAY_TYPE.STRING]),
    Buffer.from(s.normalize('NFC'), 'utf8'),
    Buffer.from([DJAY_TYPE.NULL])
  ]);
}

/* ------------------------------------------------- binary plist (bplist00) */

/**
 * Lettore minimo di binary plist.
 *
 * Formato pubblico e stabile di Apple, quindi molto meno rischioso del
 * proprietario: intestazione `bplist00`, tabella degli oggetti, e in coda 32
 * byte di trailer con le dimensioni dei riferimenti.
 *
 * Copre i tipi che compaiono in un NSKeyedArchiver: null/bool, interi, reali,
 * date, dati, stringhe ASCII e UTF-16BE, UID, array e dizionari.
 */
export function parseBinaryPlist(buf: Buffer): DjayValue {
  if (buf.length < 40 || buf.subarray(0, 6).toString('latin1') !== BPLIST_MAGIC) {
    throw new Error('non è un binary plist');
  }
  const trailer = buf.subarray(buf.length - 32);
  const offsetSize = trailer[6];
  const refSize = trailer[7];
  const numObjects = Number(trailer.readBigUInt64BE(8));
  const topObject = Number(trailer.readBigUInt64BE(16));
  const tableOffset = Number(trailer.readBigUInt64BE(24));

  const readSized = (at: number, size: number): number => {
    let v = 0;
    for (let i = 0; i < size; i++) v = v * 256 + buf[at + i];
    return v;
  };

  const offsets: number[] = [];
  for (let i = 0; i < numObjects; i++) {
    offsets.push(readSized(tableOffset + i * offsetSize, offsetSize));
  }

  const seen = new Set<number>();

  const readObject = (index: number): DjayValue => {
    if (index >= offsets.length) return null;
    /* Un plist malformato può contenere cicli. Senza guardia, un ciclo qui è
       una ricorsione infinita: l'applicazione si pianta senza dire perché. */
    if (seen.has(index)) return null;
    seen.add(index);
    try {
      let at = offsets[index];
      const marker = buf[at++];
      const type = marker >> 4;
      let count = marker & 0x0f;

      const readCount = (): number => {
        if (count !== 0x0f) return count;
        const sizeMarker = buf[at++];
        const bytes = 1 << (sizeMarker & 0x0f);
        const v = readSized(at, bytes);
        at += bytes;
        return v;
      };

      switch (type) {
        case 0x0:
          return count === 0 ? null : count === 8 ? false : count === 9 ? true : null;
        case 0x1: {
          const n = readSized(at, 1 << count);
          return n;
        }
        case 0x2:
          return count === 2 ? buf.readFloatBE(at) : buf.readDoubleBE(at);
        case 0x3:
          // Data Apple: secondi dal 2001-01-01. Si restituisce in millisecondi
          // dall'epoca Unix, che è ciò che il resto del programma usa.
          return (buf.readDoubleBE(at) + 978307200) * 1000;
        case 0x4: {
          count = readCount();
          return SKIPPED_BINARY;
        }
        case 0x5: {
          count = readCount();
          return buf.subarray(at, at + count).toString('latin1');
        }
        case 0x6: {
          count = readCount();
          const b = Buffer.from(buf.subarray(at, at + count * 2));
          b.swap16(); // UTF-16 BIG-endian sul filo
          return b.toString('utf16le');
        }
        case 0x8:
          // UID: riferimento a un altro oggetto, risolto subito.
          return readObject(readSized(at, count + 1));
        case 0xa:
        case 0xc: {
          count = readCount();
          const out: DjayValue[] = [];
          for (let i = 0; i < count; i++) {
            out.push(readObject(readSized(at + i * refSize, refSize)));
          }
          return out;
        }
        case 0xd: {
          count = readCount();
          const obj: { [k: string]: DjayValue } = {};
          for (let i = 0; i < count; i++) {
            const k = readObject(readSized(at + i * refSize, refSize));
            const v = readObject(readSized(at + (count + i) * refSize, refSize));
            obj[String(k)] = v;
          }
          return obj;
        }
        default:
          return null;
      }
    } finally {
      seen.delete(index);
    }
  };

  return readObject(topObject);
}

/**
 * Appiattisce un grafo NSKeyedArchiver nelle tre classi che portano i dati di
 * una traccia, fondendole in quest'ordine: `Location` vince su `UserData`, che
 * vince su `TitleID`.
 *
 * ⚠ `"$null"` è una **stringa sentinella**, non un valore nullo: va convertita
 * esplicitamente, altrimenti finisce nei metadati come testo.
 * ⚠ Gli `NSURL` archiviati espongono il percorso in `NS.relative`: senza
 * estrarlo si ottiene un oggetto al posto di una stringa.
 */
export const ADC_CLASSES = [
  'ADCMediaItemTitleID',
  'ADCMediaItemUserData',
  'ADCMediaItemLocation'
] as const;

export function flattenArchivedTrack(root: DjayValue): { [k: string]: DjayValue } {
  const out: { [k: string]: DjayValue } = {};

  const walk = (node: DjayValue, depth: number): void => {
    if (depth > 32 || node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const v of node) walk(v, depth + 1);
      return;
    }
    for (const [k, v] of Object.entries(node)) {
      if (k === '$class') continue;
      if (v === '$null') continue;
      if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
        const rel = (v as { [k: string]: DjayValue })['NS.relative'];
        if (typeof rel === 'string') {
          out[k] = rel;
          continue;
        }
        walk(v, depth + 1);
        continue;
      }
      if (Array.isArray(v)) {
        walk(v, depth + 1);
        continue;
      }
      if (v !== null && v !== undefined) out[k] = v;
    }
  };

  walk(root, 0);
  return out;
}
