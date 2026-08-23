import Database from 'better-sqlite3';
import type BetterSqlite3 from 'better-sqlite3';
import type { ForeignLibrary, NormPlaylist, NormTrack } from '@core/foreignImport';
import { DJAY_ROOT_PLAYLIST_UUID } from './index';
import {
  detectPayloadKind,
  flattenArchivedTrack,
  parseBinaryPlist,
  parseDjayPayload,
  type DjayValue
} from './payload';

/**
 * Lettura della libreria djay Pro.
 *
 * ⚠ Non esiste una tabella di tracce. Tutto sta in `database2`, un archivio
 * chiave-valore con quattro colonne di dominio — `collection` dice di che tipo
 * di oggetto si tratta, `data` porta il payload serializzato. Un importatore
 * che tenti `SELECT … FROM Track` non trova nulla.
 *
 * ⚠⚠ Questo lettore non è mai stato eseguito su un `MediaLibrary.db` reale.
 * Per questo NON fallisce sulla prima riga illeggibile: conta gli errori,
 * prosegue e li riporta. Un formato non collaudato che si arrende al primo
 * intoppo non dice mai quanto ci andava vicino.
 */

/** Righe lette per volta: le righe contengono blob, la libreria può essere grande. */
const PAGE = 1000;

interface Row {
  collection: string;
  key: string;
  data: Buffer | null;
}

/** Deserializza `data`, qualunque dei due formati sia. */
function decodePayload(data: Buffer): DjayValue {
  const kind = detectPayloadKind(data);
  if (kind === 'bplist') return flattenArchivedTrack(parseBinaryPlist(data));
  if (kind === 'djay') return parseDjayPayload(data);
  throw new Error('formato del payload non riconosciuto');
}

const asString = (v: unknown): string | null => {
  if (typeof v === 'string') {
    const s = v.trim();
    return s.length ? s : null;
  }
  if (typeof v === 'number') return String(v);
  return null;
};

const asNumber = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n !== 0 ? n : null;
};

/**
 * Primo valore presente fra più nomi possibili.
 *
 * ⚠ I nomi delle chiavi dentro i payload non sono documentati: la specifica
 * elenca le tre classi che li contengono, non i loro campi. Si prova un
 * ventaglio di nomi plausibili e ci si accontenta del primo che risponde —
 * meglio un campo trovato per fortuna che un campo perso per certezza.
 */
function firstOf(obj: Record<string, unknown>, ...names: string[]): unknown {
  for (const n of names) {
    if (obj[n] !== undefined && obj[n] !== null) return obj[n];
    // Le chiavi reali possono differire per maiuscole o prefisso.
    const hit = Object.keys(obj).find((k) => k.toLowerCase() === n.toLowerCase());
    if (hit && obj[hit] !== null) return obj[hit];
  }
  return undefined;
}

export interface DjayReadResult extends ForeignLibrary {
  /** Righe che non è stato possibile deserializzare. */
  unreadable: number;
  /** Righe lette in tutto, per dare un denominatore agli errori. */
  scanned: number;
}

export function readDjayLibrary(dbPath: string): DjayReadResult {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    return readFrom(db);
  } finally {
    db.close();
  }
}

export function readFrom(db: BetterSqlite3.Database): DjayReadResult {
  const warnings: string[] = [];

  const hasTable = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'database2'`)
    .get();
  if (!hasTable) {
    throw new Error(
      "Questo database non ha la tabella 'database2': non è una libreria djay Pro 5 o successiva."
    );
  }

  const tracks: NormTrack[] = [];
  const playlistRows: { uuid: string; name: string; childUUIDs: string[]; tracks: string[] }[] = [];
  let unreadable = 0;
  let scanned = 0;

  const stmt = db.prepare(
    `SELECT collection, key, data FROM database2 ORDER BY rowid LIMIT ? OFFSET ?`
  );

  for (let offset = 0; ; offset += PAGE) {
    const rows = stmt.all(PAGE, offset) as Row[];
    if (rows.length === 0) break;

    for (const row of rows) {
      scanned++;
      if (!row.data || !Buffer.isBuffer(row.data)) continue;

      let obj: Record<string, unknown>;
      try {
        const parsed = decodePayload(row.data);
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
        obj = parsed as Record<string, unknown>;
      } catch {
        unreadable++;
        continue;
      }

      const collection = (row.collection ?? '').toLowerCase();

      if (collection.includes('playlist')) {
        const uuid = asString(firstOf(obj, 'uuid', 'identifier')) ?? row.key;
        const children = firstOf(obj, 'childUUIDs', 'children');
        playlistRows.push({
          uuid,
          name: asString(firstOf(obj, 'name', 'title')) ?? uuid,
          childUUIDs: Array.isArray(children) ? children.map(String) : [],
          tracks: (() => {
            const t = firstOf(obj, 'mediaItemUUIDs', 'trackUUIDs', 'items');
            return Array.isArray(t) ? t.map(String) : [];
          })()
        });
        continue;
      }

      // Tutto ciò che non è playlist e porta un titolo lo trattiamo come traccia.
      const title = asString(firstOf(obj, 'title', 'songName', 'name'));
      const path = asString(firstOf(obj, 'NS.relative', 'location', 'path', 'fileURL'));
      if (!title && !path) continue;

      tracks.push({
        sourceId: row.key,
        title,
        artist: asString(firstOf(obj, 'artist', 'artistName')),
        album: asString(firstOf(obj, 'album', 'albumName')),
        genre: asString(firstOf(obj, 'genre')),
        year: asNumber(firstOf(obj, 'year', 'releaseYear')),
        bpm: asNumber(firstOf(obj, 'bpm', 'tempo')),
        musicalKey: asString(firstOf(obj, 'key', 'musicalKey')),
        durationS: (() => {
          const d = asNumber(firstOf(obj, 'duration', 'length'));
          if (d === null) return null;
          // Nessun brano dura 10.000 secondi: oltre, è in millisecondi.
          return d > 10_000 ? d / 1000 : d;
        })(),
        path: path ? path.replace(/^file:\/\/(localhost)?/, '') : null,
        filesize: asNumber(firstOf(obj, 'fileSize', 'size')),
        cues: [],
        rating: asNumber(firstOf(obj, 'rating')),
        /* Identità nativa e collezione d'origine: servono per riscrivere
           invece di reinserire, e per capire da dove viene una riga se il
           riconoscimento dei campi si rivelasse sbagliato. */
        formatData: { key: row.key, collection: row.collection }
      });
    }

    if (rows.length < PAGE) break;
  }

  if (unreadable > 0) {
    warnings.push(
      `${unreadable} righe su ${scanned} non sono state deserializzate. Il formato di djay ` +
        'non è ancora stato verificato su una libreria reale: segnalalo se il numero è alto.'
    );
  }
  warnings.push(
    'I cue di djay non sono stati importati: stanno nei blocchi binari, che questo ' +
      'lettore salta perché il loro formato non è documentato.'
  );

  return {
    source: 'djay',
    formatNamespace: 'djay',
    tracks,
    playlists: buildPlaylistTree(playlistRows, tracks),
    warnings,
    unreadable,
    scanned
  };
}

/**
 * Albero delle playlist, per UUID.
 *
 * ⚠ La radice si riconosce da un UUID fisso ed è una cartella **anche se priva
 * di figli** — caso che si presenta su una libreria appena creata e che, se non
 * gestito, fa perdere la radice e con essa tutto l'albero.
 */
function buildPlaylistTree(
  rows: { uuid: string; name: string; childUUIDs: string[]; tracks: string[] }[],
  tracks: NormTrack[]
): NormPlaylist[] {
  const noti = new Set(tracks.map((t) => t.sourceId));
  const parentOf = new Map<string, string>();
  for (const r of rows) {
    for (const child of r.childUUIDs) parentOf.set(child, r.uuid);
  }

  return rows.map((r) => ({
    sourceId: r.uuid,
    name: r.name,
    isFolder: r.childUUIDs.length > 0 || r.uuid === DJAY_ROOT_PLAYLIST_UUID,
    parentSourceId: parentOf.get(r.uuid) ?? null,
    trackSourceIds: r.tracks.filter((t) => noti.has(t))
  }));
}
