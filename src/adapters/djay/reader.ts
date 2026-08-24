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
 * ⚠⚠ Eseguito su un `MediaLibrary.db` reale il 24/08/2026, e la libreria
 * reale ha smentito due cose che i test sintetici confermavano.
 *
 * La prima è nel parser dei payload: il formato è little-endian, non
 * big-endian (vedi `payload.ts`). La seconda è qui: NON basta «ha un titolo,
 * quindi è una traccia». Su una libreria vera quella regola importava 99
 * `contentPacks` — i pacchetti di contenuti che djay distribuisce — come se
 * fossero musica dell'utente, perché anche loro hanno un nome. Le collezioni
 * ora sono elencate una per una: quello che non è riconosciuto viene contato e
 * ignorato, mai indovinato.
 *
 * NON fallisce sulla prima riga illeggibile: conta gli errori per collezione,
 * prosegue e li riporta. Un formato non del tutto decifrato che si arrende al
 * primo intoppo non dice mai quanto ci andava vicino.
 */

/** Righe lette per volta: le righe contengono blob, la libreria può essere grande. */
const PAGE = 1000;

/**
 * Collezioni che contengono musica dell'utente.
 *
 * ⚠ Elenco CHIUSO, e deve restare tale. La versione precedente trattava come
 * traccia qualunque oggetto con un titolo: su una libreria reale con un solo
 * brano importava 80 righe, perché i pacchetti di contenuti di djay hanno un
 * nome esattamente come un brano. Una collezione sconosciuta viene contata e
 * saltata; se un giorno ne compare una nuova la si aggiunge qui, dopo averla
 * guardata.
 */
const COLLEZIONI_TRACCE = new Set([
  /* Metadati: title, artist, duration, isrc. */
  'mediaitemtitleids',
  /* Posizione del file su disco, con i metadati incorporati. */
  'globalmediaitemlocations'
]);

/** Collezioni di playlist. */
const COLLEZIONI_PLAYLIST = new Set(['mediaitemplaylists']);

/**
 * Collezioni note che NON sono musica dell'utente. Elencarle serve a
 * distinguere «so cos'è e non mi serve» da «non so cos'è»: solo il secondo
 * caso merita un avviso.
 */
const COLLEZIONI_IGNORATE = new Set([
  /* Contenuti distribuiti da djay, non dell'utente. */
  'contentpacks',
  'contentpackmediaitems',
  /* Stato dell'applicazione e cronologia delle serate. */
  'databaseinfo',
  'queues',
  'historysessions',
  'historysessionitems',
  /* Valutazioni, cue e analisi: hanno una traccia a cui riferirsi, ma il
     legame non è ancora decifrato — vedi l'avviso in coda alla lettura. */
  'mediaitemuserdata',
  'mediaitemanalyzeddata'
]);

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
  /**
   * Righe lette e righe fallite, collezione per collezione.
   *
   * Un totale unico dice «il 13% non si legge» e non aiuta: nasconde se il
   * problema è in una collezione che non interessa a nessuno o proprio in
   * quella che porta i brani. Questa ripartizione è il primo posto da guardare
   * quando djay cambia formato.
   */
  byCollection: { collection: string; rows: number; unreadable: number; kind: string }[];
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
  const sconosciute = new Set<string>();
  const perCollezione = new Map<string, { rows: number; unreadable: number; kind: string }>();

  const stmt = db.prepare(
    `SELECT collection, key, data FROM database2 ORDER BY rowid LIMIT ? OFFSET ?`
  );

  for (let offset = 0; ; offset += PAGE) {
    const rows = stmt.all(PAGE, offset) as Row[];
    if (rows.length === 0) break;

    for (const row of rows) {
      scanned++;
      const nomeColl = row.collection ?? '(senza nome)';
      if (!perCollezione.has(nomeColl)) {
        perCollezione.set(nomeColl, { rows: 0, unreadable: 0, kind: 'vuoto' });
      }
      const cnt = perCollezione.get(nomeColl)!;
      cnt.rows++;
      if (row.data && Buffer.isBuffer(row.data)) cnt.kind = detectPayloadKind(row.data);

      /* La classificazione viene PRIMA della decodifica, e non è un dettaglio
         di efficienza. `unreadable` finisce in un avviso all'utente: se
         contasse anche le righe di collezioni che non importiamo, direbbe
         «non leggo il 13% della tua libreria» per righe che nessuno voleva.
         La ripartizione per collezione le registra comunque. */
      const collection = (row.collection ?? '').toLowerCase();
      const utile = COLLEZIONI_TRACCE.has(collection) || COLLEZIONI_PLAYLIST.has(collection);
      if (!utile) {
        if (!COLLEZIONI_IGNORATE.has(collection)) sconosciute.add(nomeColl);
        continue;
      }

      if (!row.data || !Buffer.isBuffer(row.data)) {
        cnt.unreadable++;
        unreadable++;
        continue;
      }

      let obj: Record<string, unknown>;
      try {
        const parsed = decodePayload(row.data);
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          cnt.unreadable++;
          unreadable++;
          continue;
        }
        obj = parsed as Record<string, unknown>;
      } catch {
        cnt.unreadable++;
        unreadable++;
        continue;
      }

      if (COLLEZIONI_PLAYLIST.has(collection)) {
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

      /* Da qui in giù siamo dentro una collezione di tracce dichiarata sopra.
         Un oggetto senza né titolo né percorso non è una traccia utile: si
         conta come illeggibile, perché stava in una collezione da cui ci
         aspettavamo un brano e non l'abbiamo ricavato. */
      const title = asString(firstOf(obj, 'title', 'songName', 'name'));
      const path = asString(firstOf(obj, 'NS.relative', 'location', 'path', 'fileURL'));
      if (!title && !path) {
        unreadable++;
        continue;
      }

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
      `${unreadable} righe delle collezioni di brani non sono state deserializzate ` +
        `(su ${scanned} righe totali nel database). Il formato di djay è ricostruito ` +
        'per osservazione: segnalalo se il numero è alto.'
    );
  }
  if (sconosciute.size > 0) {
    warnings.push(
      `Collezioni non riconosciute e quindi ignorate: ${[...sconosciute].join(', ')}. ` +
        'Se una di queste contiene i tuoi brani, segnalalo: verranno ignorati.'
    );
  }
  warnings.push(
    'I cue di djay non sono stati importati: stanno nei blocchi binari, che questo ' +
      'lettore salta perché il loro formato non è documentato.'
  );
  warnings.push(
    'Valutazioni, BPM analizzati e beatgrid non sono stati importati: stanno in ' +
      '`mediaItemUserData` e `mediaItemAnalyzedData`, e il legame fra quelle righe e ' +
      'il singolo brano non è ancora stato decifrato.'
  );

  return {
    source: 'djay',
    formatNamespace: 'djay',
    tracks,
    playlists: buildPlaylistTree(playlistRows, tracks),
    warnings,
    unreadable,
    scanned,
    byCollection: [...perCollezione.entries()]
      .map(([collection, c]) => ({ collection, ...c }))
      .sort((a, b) => b.rows - a.rows)
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
