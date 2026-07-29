import Database from 'better-sqlite3';
import type BetterSqlite3 from 'better-sqlite3';
import { migrate } from './schema';
import type { ForeignSource } from './foreignImport';

/** Tutti i valori possibili di tracks.source (dal v4 non più vincolati in DB). */
export type TrackSource = 'masterdb' | 'xml' | ForeignSource;

/**
 * Apre (creandolo se manca) il database UDM in chiaro.
 * Node è l'owner di schema e migrazioni; WAL + busy_timeout per convivere
 * con il sidecar Python che scrive nelle tabelle di ingestion.
 */
export function openUdm(udmPath: string): BetterSqlite3.Database {
  const db = new Database(udmPath);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = NORMAL');
  // FK OFF durante le migrazioni: la v4 ricostruisce tracks/playlists e il DROP
  // non deve innescare i CASCADE su cues/playlist_tracks. Riattivate subito dopo.
  db.pragma('foreign_keys = OFF');
  migrate(db);
  db.pragma('foreign_keys = ON');
  return db;
}

export interface TrackRow {
  id: number;
  source: TrackSource;
  source_id: string | null;
  title: string | null;
  artist: string | null;
  album: string | null;
  genre: string | null;
  year: number | null;
  bpm: number | null;
  musical_key: string | null;
  camelot: string | null;
  duration_s: number | null;
  path: string | null;
  filesize: number | null;
  file_mtime: number | null;
  version_label: string | null;
  has_tag_issues: number;
  needs_review: number;
  review_reason: string | null;
  acoustic_id: string | null;
  created_at: string;
  gain_db: number | null;
  rating: number | null;
  track_color: string | null;
  beatgrid_bpm: number | null;
  beatgrid_anchor_ms: number | null;
}

export interface PageQuery {
  offset: number;
  limit: number;
  search?: string;
  needsReview?: boolean;
}

/** Lettura paginata: la UI non riceve mai l'intera libreria in un colpo solo. */
export function getTracksPage(db: BetterSqlite3.Database, q: PageQuery): { rows: TrackRow[]; total: number } {
  const where: string[] = [];
  const params: Record<string, unknown> = {};
  if (q.search) {
    // Escape dei metacaratteri LIKE (% _ e il backslash stesso): senza, cercare
    // "100%" o un path con "_" darebbe match spuri da wildcard.
    where.push(
      `(title LIKE :s ESCAPE '\\' OR artist LIKE :s ESCAPE '\\' OR path LIKE :s ESCAPE '\\')`
    );
    params.s = `%${q.search.replace(/[\\%_]/g, '\\$&')}%`;
  }
  if (q.needsReview !== undefined) {
    where.push(`needs_review = :nr`);
    params.nr = q.needsReview ? 1 : 0;
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = (
    db.prepare(`SELECT COUNT(*) AS c FROM tracks ${whereSql}`).get(params) as { c: number }
  ).c;
  const rows = db
    .prepare(
      `SELECT * FROM tracks ${whereSql} ORDER BY artist, title LIMIT :limit OFFSET :offset`
    )
    .all({ ...params, limit: q.limit, offset: q.offset }) as TrackRow[];
  return { rows, total };
}

/** Brani di una playlist, paginati e in ordine di posizione. */
export function getPlaylistTracksPage(
  db: BetterSqlite3.Database,
  playlistId: number,
  offset: number,
  limit: number
): { rows: TrackRow[]; total: number } {
  const total = (
    db
      .prepare(`SELECT COUNT(*) AS c FROM playlist_tracks WHERE playlist_id = ?`)
      .get(playlistId) as { c: number }
  ).c;
  const rows = db
    .prepare(
      `SELECT t.* FROM playlist_tracks pt
       JOIN tracks t ON t.id = pt.track_id
       WHERE pt.playlist_id = ?
       ORDER BY pt.position LIMIT ? OFFSET ?`
    )
    .all(playlistId, limit, offset) as TrackRow[];
  return { rows, total };
}

export function logOperation(
  db: BetterSqlite3.Database,
  operation: string,
  target: string | null,
  outcome: 'ok' | 'error' | 'dry-run' | 'skipped',
  detail?: string
): void {
  // Timestamp in ora LOCALE: il DEFAULT dello schema è datetime('now') = UTC,
  // che mostrava orari sfasati nel Registro operazioni (es. 19:16 invece di
  // 21:16 in Italia). Scriviamo esplicitamente l'ora locale così display ed
  // export sono coerenti col fuso dell'utente.
  db.prepare(
    `INSERT INTO oplog (ts, operation, target, outcome, detail)
     VALUES (strftime('%Y-%m-%d %H:%M:%S', 'now', 'localtime'), ?, ?, ?, ?)`
  ).run(operation, target, outcome, detail ?? null);
}

export function getSetting(db: BetterSqlite3.Database, key: string): string | null {
  const row = db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setSetting(db: BetterSqlite3.Database, key: string, value: string): void {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, value);
}

export interface LibraryDistribution {
  /** istogramma BPM in bucket da 5, solo tracce con BPM valido */
  bpm: { bucket: number; count: number }[];
  /** conteggio per tonalità Camelot (solo valori riconosciuti) */
  camelot: { camelot: string; count: number }[];
  /** tracce senza tonalità: si mostra come dato, non come cella vuota */
  noKey: number;
  /** brano più vecchio/più recente per data di inserimento, per la panoramica */
  firstImport: string | null;
  lastImport: string | null;
}

/**
 * Aggregati per la panoramica: distribuzione BPM e copertura tonalità.
 * Sono conteggi calcolati in SQL — non passa mai la libreria sul bridge IPC.
 */
export function getLibraryDistribution(db: BetterSqlite3.Database): LibraryDistribution {
  const bpm = db
    .prepare(
      `SELECT CAST(bpm / 5 AS INTEGER) * 5 AS bucket, COUNT(*) AS count
         FROM tracks
        WHERE bpm IS NOT NULL AND bpm > 40 AND bpm < 220
        GROUP BY bucket
        ORDER BY bucket`
    )
    .all() as { bucket: number; count: number }[];

  const camelot = db
    .prepare(
      `SELECT camelot, COUNT(*) AS count
         FROM tracks
        WHERE camelot IS NOT NULL AND camelot <> ''
        GROUP BY camelot`
    )
    .all() as { camelot: string; count: number }[];

  const noKey = (
    db
      .prepare(`SELECT COUNT(*) AS c FROM tracks WHERE camelot IS NULL OR camelot = ''`)
      .get() as { c: number }
  ).c;

  const bounds = db
    .prepare(`SELECT MIN(created_at) AS first, MAX(created_at) AS last FROM tracks`)
    .get() as { first: string | null; last: string | null };

  return { bpm, camelot, noKey, firstImport: bounds.first, lastImport: bounds.last };
}
