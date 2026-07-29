import Database from 'better-sqlite3';
import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, relative, sep } from 'path';
import {
  defaultTrailer,
  encodeLoops,
  encodeQuickCues,
  encodeTrackData,
  ENGINE_PAD_COLORS,
  ENGINE_SLOTS,
  frameZlib,
  msToSamples,
  type EngineLoopSlot
} from './engineCodec';
import {
  getCuesForTrack,
  getPlaylists,
  getPlaylistTrackIds,
  iterateTracks,
  type ExportSelection
} from '../common';
import type BetterSqlite3 from 'better-sqlite3';

/**
 * Export verso Engine DJ: genera una Engine Library NUOVA.
 *
 * Perché una libreria nuova e non una modifica di quella esistente: il
 * database di Engine contiene blob che sappiamo leggere ma non ricreare in
 * tutte le loro parti (la forma d'onda, la griglia dei beat, alcuni campi di
 * `trackData` restano inspiegati). Riscrivere il database dell'utente
 * significherebbe rischiare quei dati; generarne uno nuovo, che l'utente apre
 * quando vuole, non tocca nulla di suo.
 *
 * Lo schema NON è incorporato nel codice: viene copiato da un m.db esistente
 * indicato dall'utente. Così la libreria generata ha esattamente la versione
 * di schema della sua installazione, invece di una nostra ipotesi che una
 * versione futura di Engine potrebbe rifiutare.
 *
 * Quello che scriviamo (misurato e verificato byte-per-byte): metadati del
 * brano, hot cue e loop. Quello che NON scriviamo, e che Engine ricalcola alla
 * prima analisi: forma d'onda, griglia dei beat, key analizzata.
 */

export interface EngineExportResult {
  tracks: number;
  cues: number;
  loops: number;
  playlists: number;
  dbPath: string;
  warnings: string[];
}

/** Colonne di Track che valorizziamo (le altre restano al default dello schema). */
const TRACK_COLUMNS = [
  'playOrder',
  'length',
  'bpm',
  'year',
  'path',
  'filename',
  'bitrate',
  'bpmAnalyzed',
  'albumArtId',
  'fileBytes',
  'title',
  'artist',
  'album',
  'genre',
  'comment',
  'label',
  'composer',
  'isAnalyzed',
  'dateCreated',
  'explicitLyrics',
  'timeLastPlayed',
  'isPlayed',
  'fileType',
  'isAvailable',
  'isMetadataOfPackedTrackChanged',
  'isPerfomanceDataOfPackedTrackChanged',
  'playedIndicator',
  'isMetadataImported',
  'streamingFlags',
  'explicitLyrics'
] as const;

/**
 * Path Engine: relativo alla cartella "Engine Library" stessa (non a quella
 * che la contiene — verificato sui dati reali), con separatori POSIX.
 *
 * I ".." sono legittimi e Engine li usa davvero (nella libreria di riferimento
 * i path sono del tipo "../../Desktop/…"): quello che invece NON è
 * rappresentabile è un brano su un ALTRO disco, perché lì `relative` non può
 * produrre un percorso relativo e restituisce un assoluto. In quel caso la
 * traccia viene saltata con un avviso, invece di scrivere un riferimento rotto.
 */
function enginePath(trackPath: string, libraryRoot: string): string | null {
  const rel = relative(libraryRoot, trackPath);
  if (!rel || /^[a-z]:/i.test(rel)) return null;
  return rel.split(sep).join('/');
}

/**
 * Copertina incorporata nel file (frame ID3 APIC) → immagine grezza.
 *
 * Lettura minimale del tag ID3v2 senza dipendenze: cerchiamo il primo frame
 * APIC e ne estraiamo i byte dell'immagine. Serve solo per l'export verso
 * Engine, che tiene le copertine come file separati: se qualcosa non torna
 * restituiamo null e la traccia resta semplicemente senza cover.
 */
function readEmbeddedArtwork(filePath: string): Buffer | null {
  let buf: Buffer;
  try {
    buf = readFileSync(filePath);
  } catch {
    return null;
  }
  if (buf.length < 10 || buf.toString('latin1', 0, 3) !== 'ID3') return null;
  const major = buf[3];
  // Dimensione del tag: 4 byte "sincsafe" (7 bit utili ciascuno).
  const tagSize = ((buf[6] & 0x7f) << 21) | ((buf[7] & 0x7f) << 14) | ((buf[8] & 0x7f) << 7) | (buf[9] & 0x7f);
  let off = 10;
  const end = Math.min(10 + tagSize, buf.length);
  while (off + 10 <= end) {
    const id = buf.toString('latin1', off, off + 4);
    if (!/^[A-Z0-9]{4}$/.test(id)) break; // padding o fine dei frame
    const size =
      major >= 4
        ? ((buf[off + 4] & 0x7f) << 21) |
          ((buf[off + 5] & 0x7f) << 14) |
          ((buf[off + 6] & 0x7f) << 7) |
          (buf[off + 7] & 0x7f)
        : buf.readUInt32BE(off + 4);
    const body = off + 10;
    if (size <= 0 || body + size > end) break;
    if (id === 'APIC') {
      let p = body;
      p += 1; // byte di encoding del testo
      // MIME type, terminato da NUL
      const mimeEnd = buf.indexOf(0, p);
      if (mimeEnd < 0 || mimeEnd >= body + size) return null;
      p = mimeEnd + 1;
      p += 1; // tipo di immagine (copertina frontale, retro…)
      // Descrizione, anch'essa terminata da NUL
      const descEnd = buf.indexOf(0, p);
      if (descEnd < 0 || descEnd >= body + size) return null;
      p = descEnd + 1;
      const img = buf.subarray(p, body + size);
      return img.length > 0 ? img : null;
    }
    off = body + size;
  }
  return null;
}

export function writeEngineLibrary(
  db: BetterSqlite3.Database,
  outDir: string,
  templateDbPath: string,
  sel: ExportSelection = {},
  onProgress?: (done: number) => void,
  /**
   * Cartella rispetto a cui calcolare i path dei brani, se DIVERSA da quella
   * in cui scriviamo. Serve quando la libreria verrà usata da un'altra
   * posizione (una chiavetta, o la cartella Musica al posto di quella
   * esistente): i path Engine sono relativi, quindi generarli rispetto alla
   * cartella di staging li romperebbe a destinazione.
   */
  pathBase?: string
): EngineExportResult {
  const warnings: string[] = [];
  if (!existsSync(templateDbPath)) {
    throw new Error(
      'Serve un m.db di Engine esistente come modello dello schema: indica quello della tua installazione.'
    );
  }

  // 1) Schema copiato dall'installazione dell'utente (stessa versione).
  const template = new Database(templateDbPath, { readonly: true });
  const ddl = template
    .prepare(`SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'`)
    .all() as { sql: string }[];
  const info = template.prepare('SELECT * FROM Information LIMIT 1').get() as
    | Record<string, unknown>
    | undefined;
  const trackCols = new Set(
    (template.prepare('PRAGMA table_info(Track)').all() as { name: string }[]).map((c) => c.name)
  );
  template.close();

  // Base per i path relativi: la cartella "Engine Library" della destinazione
  // FINALE (che può differire da dove stiamo scrivendo, vedi pathBase).
  const pathRoot = join(pathBase ?? outDir, 'Engine Library');
  const dbDir = join(outDir, 'Engine Library', 'Database2');
  mkdirSync(dbDir, { recursive: true });
  const dbPath = join(dbDir, 'm.db');
  if (existsSync(dbPath)) {
    throw new Error(`Esiste già una libreria Engine in ${dbDir}: scegli un'altra cartella.`);
  }

  const out = new Database(dbPath);
  out.pragma('journal_mode = delete'); // come Engine: nessun file -wal/-shm
  let written = 0;
  let cueCount = 0;
  let loopCount = 0;
  let playlistCount = 0;
  // Le playlist esistono solo se lo schema del modello le prevede.
  const hasPlaylistTables = ddl.some((d) => /CREATE TABLE\s+"?Playlist"?\s*\(/i.test(d.sql));
  // databaseUuid delle voci di playlist: è l'UUID della libreria.
  const libraryUuid = String((info?.uuid as string | undefined) ?? '');

  try {
    for (const stmt of ddl) {
      out.exec(stmt.sql);
    }
    // Information: copiamo la riga del modello così la versione di schema
    // dichiarata corrisponde a quella delle strutture che abbiamo creato.
    if (info) {
      const cols = Object.keys(info);
      out
        .prepare(
          `INSERT INTO Information (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`
        )
        .run(...cols.map((c) => info[c] as never));
    }

    const usable = TRACK_COLUMNS.filter((c) => trackCols.has(c));
    const insertTrack = out.prepare(
      `INSERT INTO Track (${usable.join(',')}) VALUES (${usable.map(() => '?').join(',')})`
    );
    /* Copertine: Engine le tiene come file in "Engine Library/Artwork" e nel
       database ne conserva solo l'impronta. Verificato sui dati reali: il nome
       del file è lo SHA-1 dell'immagine in base64url (senza padding), e la
       colonna AlbumArt.hash contiene gli stessi 20 byte in forma binaria. */
    const artDir = join(outDir, 'Engine Library', 'Artwork');
    mkdirSync(artDir, { recursive: true });
    const insertArt = out.prepare('INSERT INTO AlbumArt (hash, albumArt) VALUES (?, NULL)');
    const artIdByHash = new Map<string, number>();
    const artworkFor = (trackPath: string): number | null => {
      const img = readEmbeddedArtwork(trackPath);
      if (!img) return null;
      const sha1 = createHash('sha1').update(img).digest();
      const key = sha1.toString('hex');
      const known = artIdByHash.get(key);
      if (known !== undefined) return known; // copertina già vista: si riusa
      const name = sha1.toString('base64url').replace(/=+$/, '');
      try {
        writeFileSync(join(artDir, `${name}.jpg`), img);
      } catch {
        return null;
      }
      const id = Number(insertArt.run(sha1).lastInsertRowid);
      artIdByHash.set(key, id);
      return id;
    };

    const insertPerf = out.prepare(
      `INSERT INTO PerformanceData (trackId, trackData, quickCues, loops)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(trackId) DO UPDATE SET
         trackData = excluded.trackData,
         quickCues = excluded.quickCues,
         loops = excluded.loops`
    );

    // trackId nell'UDM → id nella libreria generata, per le playlist.
    const idMap = new Map<number, number>();

    const run = out.transaction(() => {
      for (const t of iterateTracks(db, sel)) {
        if (!t.path) continue;
        const rel = enginePath(t.path, pathRoot);
        if (!rel) {
          warnings.push(`"${t.title ?? t.path}" è su un altro disco rispetto alla libreria: saltato.`);
          continue;
        }
        const filename = t.path.split(/[\\/]/).pop() ?? '';
        const values: Record<string, unknown> = {
          playOrder: written + 1,
          length: t.duration_s !== null ? Math.round(t.duration_s) : null,
          bpm: t.bpm !== null ? Math.round(t.bpm) : null,
          year: t.year,
          path: rel,
          filename,
          bitrate: null,
          bpmAnalyzed: t.bpm,
          // Copertina estratta dal file e registrata in AlbumArt; null se il
          // brano non ne ha una (mai 0: c'è una foreign key su AlbumArt.id).
          albumArtId: artworkFor(t.path),
          fileBytes: t.filesize,
          title: t.title,
          artist: t.artist,
          album: t.album,
          genre: t.genre,
          comment: null,
          label: null,
          composer: null,
          // 0 = da analizzare: Engine ricostruisce forma d'onda e griglia.
          isAnalyzed: 0,
          dateCreated: null,
          explicitLyrics: 0,
          timeLastPlayed: null,
          isPlayed: 0,
          fileType: (filename.split('.').pop() ?? '').toLowerCase(),
          isAvailable: 1,
          isMetadataOfPackedTrackChanged: 0,
          isPerfomanceDataOfPackedTrackChanged: 0,
          playedIndicator: 0,
          isMetadataImported: 1,
          streamingFlags: 0
        };
        const trackId = Number(insertTrack.run(...usable.map((c) => values[c] as never)).lastInsertRowid);
        idMap.set(t.id, trackId);

        // Cue e loop: gli 8 pad di Engine.
        const sampleRate = 44100; // ricalcolata da Engine all'analisi
        const cues = getCuesForTrack(db, t.id);
        const slots: ({ label: string; positionSamples: number; color: string } | null)[] = new Array(
          ENGINE_SLOTS
        ).fill(null);
        const loopSlots: (EngineLoopSlot | null)[] = new Array(ENGINE_SLOTS).fill(null);
        let nextFreeCue = 0;
        let nextFreeLoop = 0;
        for (const c of cues) {
          if (c.cue_type === 'loop' && c.length_ms !== null) {
            const idx = c.cue_index !== null && c.cue_index < ENGINE_SLOTS ? c.cue_index : nextFreeLoop;
            if (idx >= ENGINE_SLOTS || loopSlots[idx]) continue;
            loopSlots[idx] = {
              label: c.label ?? `Loop ${idx + 1}`,
              startSamples: msToSamples(c.position_ms, sampleRate),
              endSamples: msToSamples(c.position_ms + c.length_ms, sampleRate),
              color: c.color ?? ENGINE_PAD_COLORS[idx]
            };
            nextFreeLoop = Math.max(nextFreeLoop, idx + 1);
            loopCount++;
          } else if (c.cue_type === 'hot' || c.cue_type === 'memory') {
            const idx = c.cue_index !== null && c.cue_index < ENGINE_SLOTS ? c.cue_index : nextFreeCue;
            if (idx >= ENGINE_SLOTS || slots[idx]) continue;
            slots[idx] = {
              label: c.label ?? `Cue ${idx + 1}`,
              positionSamples: msToSamples(c.position_ms, sampleRate),
              color: c.color ?? ENGINE_PAD_COLORS[idx]
            };
            nextFreeCue = Math.max(nextFreeCue, idx + 1);
            cueCount++;
          }
        }

        const totalSamples = t.duration_s !== null ? t.duration_s * sampleRate : 0;
        insertPerf.run(
          trackId,
          frameZlib(encodeTrackData(sampleRate, totalSamples)),
          frameZlib(encodeQuickCues({ slots, trailer: defaultTrailer() })),
          encodeLoops(loopSlots) // i loop NON sono compressi
        );
        written++;
        if (written % 200 === 0) onProgress?.(written);
      }

      /* Playlist: in Engine sono due liste concatenate — `nextListId` collega
         una playlist alla successiva, `nextEntityId` un brano al successivo, e
         lo zero segna la fine. Le scriviamo solo se le tabelle esistono in
         questo schema, e solo per le playlist che non sono cartelle. */
      if (!hasPlaylistTables) return;
      const lists = getPlaylists(db, sel).filter((p) => !p.is_folder);
      if (!lists.length) return;

      const insertList = out.prepare(
        `INSERT INTO Playlist (title, parentListId, isPersisted, nextListId, lastEditTime, isExplicitlyExported)
         VALUES (?, 0, 1, 0, datetime('now'), 1)`
      );
      const insertEntity = out.prepare(
        `INSERT INTO PlaylistEntity (listId, trackId, databaseUuid, nextEntityId, membershipReference)
         VALUES (?, ?, ?, 0, 0)`
      );
      const linkList = out.prepare('UPDATE Playlist SET nextListId = ? WHERE id = ?');
      const linkEntity = out.prepare('UPDATE PlaylistEntity SET nextEntityId = ? WHERE id = ?');

      const listIds: number[] = [];
      for (const p of lists) {
        const trackIds = getPlaylistTrackIds(db, p.id)
          .map((id) => idMap.get(id))
          .filter((id): id is number => id !== undefined);
        if (!trackIds.length) continue; // playlist vuota: niente da scrivere

        const listId = Number(insertList.run(p.name).lastInsertRowid);
        listIds.push(listId);

        const entityIds: number[] = [];
        for (const tid of trackIds) {
          entityIds.push(Number(insertEntity.run(listId, tid, libraryUuid).lastInsertRowid));
        }
        // Concatena i brani nell'ordine della playlist; l'ultimo resta a 0.
        for (let i = 0; i < entityIds.length - 1; i++) {
          linkEntity.run(entityIds[i + 1], entityIds[i]);
        }
        playlistCount++;
      }
      // Concatena le playlist tra loro; l'ultima resta a 0.
      for (let i = 0; i < listIds.length - 1; i++) {
        linkList.run(listIds[i + 1], listIds[i]);
      }
    });
    run();
  } finally {
    out.close();
  }

  if (cueCount === 0 && loopCount === 0) {
    warnings.push('Nessun cue o loop da esportare: la libreria conterrà solo i brani.');
  }
  warnings.push(
    'Engine ricalcola forma d\'onda e griglia dei beat alla prima analisi: apri la libreria e lascia analizzare i brani.'
  );
  return { tracks: written, cues: cueCount, loops: loopCount, playlists: playlistCount, dbPath, warnings };
}
