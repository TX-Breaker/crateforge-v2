import Database from 'better-sqlite3';
import { dirname, join, resolve } from 'path';
import { inflateSync } from 'zlib';
import type { ForeignLibrary, NormCue, NormPlaylist, NormTrack } from '@core/foreignImport';

/**
 * Reader Engine DJ (Denon / Engine Prime / Engine OS).
 * L'Engine Library è un database SQLite IN CHIARO (non cifrato): lo apriamo in
 * sola lettura con better-sqlite3. Lo schema cambia parecchio tra versioni,
 * quindi il reader è difensivo: introspeziona le colonne di Track e usa solo
 * quelle presenti. I cue/loop sono blob impacchettati (PerformanceData) e per
 * ora NON vengono importati (avviso). Le playlist sì, se presenti.
 *
 * Percorso tipico del db: "<drive>/Engine Library/Database2/m.db".
 */

// Engine memorizza la key come intero 0..23, ma NON è cromatico: è ordinato
// CAMELOT (verificato su 400 file reali, vedi docs/INTEROPERABILITA-DJ.md §2.5).
// Regola: camelot = (key>>1)+1; pari = major (lato B), dispari = minor (lato A).
// 0 = B major (1B), non C. La vecchia mappa cromatica dava la key SBAGLIATA su
// ogni brano Engine. Qui usiamo direttamente il nome nota corretto; toCamelot
// (in importForeignLibrary) ne ricava la notazione Camelot.
const ENGINE_KEY: Record<number, string> = {
  0: 'B', 1: 'G#m', 2: 'F#', 3: 'D#m', 4: 'C#', 5: 'A#m',
  6: 'G#', 7: 'Fm', 8: 'D#', 9: 'Cm', 10: 'A#', 11: 'Gm',
  12: 'F', 13: 'Dm', 14: 'C', 15: 'Am', 16: 'G', 17: 'Em',
  18: 'D', 19: 'Bm', 20: 'A', 21: 'F#m', 22: 'E', 23: 'C#m'
};

/** Blob Engine con framing [uint32 BE lunghezza][stream zlib] → payload grezzo. */
function decodeFramedZlib(blob: unknown): Buffer | null {
  if (!Buffer.isBuffer(blob) || blob.length < 6) return null;
  try {
    return inflateSync(blob.subarray(4));
  } catch {
    return null;
  }
}

/** 4 byte ARGB Engine (byte0 = alpha/enabled) → "#RRGGBB", o null se slot vuoto. */
function argbToHex(buf: Buffer, off: number): string | null {
  if (off + 4 > buf.length || buf[off] === 0) return null;
  const hex = (n: number) => n.toString(16).padStart(2, '0');
  return ('#' + hex(buf[off + 1]) + hex(buf[off + 2]) + hex(buf[off + 3])).toUpperCase();
}

/** Sample rate per-traccia (double BE @0 di trackData); 44100 come fallback. */
function sampleRateOf(trackData: unknown): number {
  const td = decodeFramedZlib(trackData);
  if (td && td.length >= 8) {
    const sr = td.readDoubleBE(0);
    if (sr >= 8000 && sr <= 192000) return sr;
  }
  return 44100;
}

// NOTA beatgrid Engine: il blob `beatData` (framed zlib, header BE) contiene i
// marker della griglia, ma il layout dei marker è complesso e version-dipendente
// e non è ancora reverse-engineered in modo affidabile (il primo marker NON è un
// semplice double sample-offset). Per non rischiare un downbeat errato, l'anchor
// Engine NON viene estratto: i writer ripiegano su griglia a BPM costante da 0.
// Follow-up: parser dedicato di `beatData` validato su dati reali.

/**
 * Decodifica i cue Engine dai blob PerformanceData (roadmap §7.9, prima persi).
 * Hot cue in `quickCues` (framed zlib, header int64 BE, posizioni in SAMPLE
 * double BE, colore ARGB). Loop in `loops` (NON compresso, little-endian).
 * Le posizioni sample si convertono in ms con la sample rate del brano.
 */
function readEngineCues(quickCues: unknown, loops: unknown, sampleRate: number): NormCue[] {
  const out: NormCue[] = [];
  const toMs = (samples: number) => (samples / sampleRate) * 1000;

  const qc = decodeFramedZlib(quickCues);
  if (qc && qc.length >= 8) {
    let off = 8; // salta l'header int64 BE (numero slot, tipicamente 8)
    const count = Number(qc.readBigInt64BE(0));
    for (let i = 0; i < count; i++) {
      if (off + 1 > qc.length) break;
      const len = qc.readUInt8(off);
      off += 1;
      const label = len ? qc.subarray(off, off + len).toString('utf8') : null;
      off += len;
      if (off + 12 > qc.length) break;
      const pos = qc.readDoubleBE(off);
      off += 8;
      const color = argbToHex(qc, off);
      off += 4;
      if (pos >= 0) out.push({ type: 'hot', index: i, positionMs: toMs(pos), lengthMs: null, color, label });
    }
  }

  if (Buffer.isBuffer(loops) && loops.length >= 8) {
    let off = 8;
    const count = Number(loops.readBigInt64LE(0));
    for (let i = 0; i < count; i++) {
      if (off + 1 > loops.length) break;
      const len = loops.readUInt8(off);
      off += 1;
      const label = len ? loops.subarray(off, off + len).toString('utf8') : null;
      off += len;
      if (off + 22 > loops.length) break;
      const start = loops.readDoubleLE(off);
      off += 8;
      const end = loops.readDoubleLE(off);
      off += 8;
      const isStart = loops.readUInt8(off);
      off += 1;
      const isEnd = loops.readUInt8(off);
      off += 1;
      const color = argbToHex(loops, off);
      off += 4;
      if (isStart && isEnd && end > start) {
        out.push({ type: 'loop', index: i, positionMs: toMs(start), lengthMs: toMs(end - start), color, label });
      }
    }
  }
  return out;
}

function columnsOf(db: Database.Database, table: string): Set<string> {
  try {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    return new Set(rows.map((r) => r.name));
  } catch {
    return new Set();
  }
}

function tableExists(db: Database.Database, table: string): boolean {
  return !!db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
    .get(table);
}

/** Prima colonna esistente tra i candidati, o null. */
function pick(cols: Set<string>, ...cands: string[]): string | null {
  for (const c of cands) if (cols.has(c)) return c;
  return null;
}

export function readEngineLibrary(dbPath: string): ForeignLibrary {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  const warnings: string[] = [];
  try {
    if (!tableExists(db, 'Track')) {
      throw new Error('Non sembra un Engine Library: manca la tabella Track.');
    }
    const cols = columnsOf(db, 'Track');
    const c = {
      id: pick(cols, 'id', 'originId') ?? 'id',
      title: pick(cols, 'title'),
      artist: pick(cols, 'artist'),
      album: pick(cols, 'album'),
      genre: pick(cols, 'genre'),
      year: pick(cols, 'year'),
      bpm: pick(cols, 'bpmAnalyzed', 'bpm'),
      key: pick(cols, 'keyAnalyzed', 'key'),
      length: pick(cols, 'length', 'lengthCalculated'),
      path: pick(cols, 'path', 'filename'),
      filename: pick(cols, 'filename'),
      filesize: pick(cols, 'fileBytes', 'size'),
      rating: pick(cols, 'rating')
    };

    const sel = [
      `${c.id} AS id`,
      c.title ? `${c.title} AS title` : `NULL AS title`,
      c.artist ? `${c.artist} AS artist` : `NULL AS artist`,
      c.album ? `${c.album} AS album` : `NULL AS album`,
      c.genre ? `${c.genre} AS genre` : `NULL AS genre`,
      c.year ? `${c.year} AS year` : `NULL AS year`,
      c.bpm ? `${c.bpm} AS bpm` : `NULL AS bpm`,
      c.key ? `${c.key} AS keyval` : `NULL AS keyval`,
      c.length ? `${c.length} AS length` : `NULL AS length`,
      c.path ? `${c.path} AS path` : `NULL AS path`,
      c.filesize ? `${c.filesize} AS filesize` : `NULL AS filesize`,
      c.rating ? `${c.rating} AS rating` : `NULL AS rating`
    ].join(', ');

    const rows = db.prepare(`SELECT ${sel} FROM Track`).all() as Record<string, unknown>[];
    const libRoot = resolve(dirname(dbPath), '..', '..'); // …/Engine Library/Database2/m.db → drive root

    // Cue/loop dai blob PerformanceData (roadmap §7.9): indicizzati per trackId.
    const perfByTrack = new Map<string, { quickCues: unknown; loops: unknown; trackData: unknown }>();
    if (tableExists(db, 'PerformanceData')) {
      const pcols = columnsOf(db, 'PerformanceData');
      const idCol = pick(pcols, 'trackId', 'id') ?? 'trackId';
      const qcCol = pick(pcols, 'quickCues');
      const loopCol = pick(pcols, 'loops');
      const tdCol = pick(pcols, 'trackData');
      if (qcCol || loopCol) {
        const psel = [
          `${idCol} AS tid`,
          qcCol ? `${qcCol} AS quickCues` : `NULL AS quickCues`,
          loopCol ? `${loopCol} AS loops` : `NULL AS loops`,
          tdCol ? `${tdCol} AS trackData` : `NULL AS trackData`
        ].join(', ');
        const prows = db.prepare(`SELECT ${psel} FROM PerformanceData`).all() as Record<string, unknown>[];
        for (const pr of prows) {
          perfByTrack.set(String(pr.tid), {
            quickCues: pr.quickCues,
            loops: pr.loops,
            trackData: pr.trackData
          });
        }
      }
    }

    const tracks: NormTrack[] = rows.map((r) => {
      const rawPath = r.path != null ? String(r.path) : null;
      // I path Engine sono spesso relativi al drive: prova a renderli assoluti.
      const path = rawPath
        ? rawPath.match(/^([A-Za-z]:|\/|\\\\)/)
          ? rawPath
          : join(libRoot, rawPath.replace(/^\.\.?[\\/]/, ''))
        : null;
      const keyval = r.keyval != null ? Number(r.keyval) : NaN;
      const musicalKey = Number.isInteger(keyval) && ENGINE_KEY[keyval] ? ENGINE_KEY[keyval] : null;
      const bpm = r.bpm != null ? Number(r.bpm) || null : null;
      const perf = perfByTrack.get(String(r.id));
      const cues = perf ? readEngineCues(perf.quickCues, perf.loops, sampleRateOf(perf.trackData)) : [];
      const rating = r.rating != null ? Number(r.rating) : null;
      return {
        sourceId: String(r.id),
        title: r.title != null ? String(r.title) : null,
        artist: r.artist != null ? String(r.artist) : null,
        album: r.album != null ? String(r.album) : null,
        genre: r.genre != null ? String(r.genre) : null,
        year: r.year != null ? Number(r.year) || null : null,
        bpm: bpm && bpm > 0 ? bpm : null,
        musicalKey,
        durationS: r.length != null ? Number(r.length) || null : null,
        path,
        filesize: r.filesize != null ? Number(r.filesize) || null : null,
        cues,
        rating: rating != null && !Number.isNaN(rating) ? rating : null
      };
    });

    // Playlist (se presenti). Schema comune: Playlist(id,title[,parentListId]),
    // PlaylistEntity(listId,trackId[,nextEntityId]).
    const playlists: NormPlaylist[] = [];
    if (tableExists(db, 'Playlist') && tableExists(db, 'PlaylistEntity')) {
      const plCols = columnsOf(db, 'Playlist');
      const titleCol = pick(plCols, 'title', 'name') ?? 'title';
      const parentCol = pick(plCols, 'parentListId', 'parentId');
      const peCols = columnsOf(db, 'PlaylistEntity');
      const trackCol = pick(peCols, 'trackId', 'databaseUuidTrackId') ?? 'trackId';
      // Engine ordina le entity con una lista concatenata (nextEntityId, 0 = fine).
      const hasChain = peCols.has('nextEntityId') && peCols.has('id');

      const pls = db
        .prepare(`SELECT id, ${titleCol} AS title${parentCol ? `, ${parentCol} AS parent` : ''} FROM Playlist`)
        .all() as { id: number; title: string; parent?: number }[];
      for (const p of pls) {
        let trackSourceIds: string[];
        if (hasChain) {
          const rows = db
            .prepare(`SELECT id, ${trackCol} AS trackId, nextEntityId AS next FROM PlaylistEntity WHERE listId = ?`)
            .all(p.id) as { id: number; trackId: number; next: number }[];
          // Testa = entity non referenziata da nessun `next`; poi segui la catena.
          const referenced = new Set(rows.map((r) => r.next).filter((n) => n));
          const byId = new Map(rows.map((r) => [r.id, r]));
          let head = rows.find((r) => !referenced.has(r.id));
          const ordered: string[] = [];
          const seen = new Set<number>();
          while (head && !seen.has(head.id)) {
            seen.add(head.id);
            ordered.push(String(head.trackId));
            head = head.next ? byId.get(head.next) : undefined;
          }
          // Se la catena è rotta/incompleta, aggiungi il resto per rowid.
          trackSourceIds =
            ordered.length === rows.length
              ? ordered
              : [...ordered, ...rows.filter((r) => !seen.has(r.id)).map((r) => String(r.trackId))];
        } else {
          const rows = db
            .prepare(`SELECT ${trackCol} AS trackId FROM PlaylistEntity WHERE listId = ? ORDER BY rowid`)
            .all(p.id) as { trackId: number }[];
          trackSourceIds = rows.map((r) => String(r.trackId));
        }
        playlists.push({
          sourceId: String(p.id),
          name: p.title ?? 'Senza nome',
          isFolder: false,
          parentSourceId: p.parent ? String(p.parent) : null,
          trackSourceIds
        });
      }
    }

    const cueTotal = tracks.reduce((s, t) => s + t.cues.length, 0);
    warnings.push(
      `Engine DJ: importati brani, BPM, key (ordinamento Camelot), rating, playlist e ${cueTotal} cue/loop dai blob PerformanceData.`
    );
    if (tracks.length === 0) warnings.push('Nessun brano trovato nel database Engine.');
    return { source: 'engine', tracks, playlists, warnings };
  } finally {
    db.close();
  }
}
