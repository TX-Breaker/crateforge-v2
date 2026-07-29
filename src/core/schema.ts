import type BetterSqlite3 from 'better-sqlite3';

/**
 * Schema UDM (Universal Data Model).
 *
 * Ownership dello schema: SOLO Node (questo modulo). Il sidecar Python riceve
 * il percorso del file via --udm-path, apre il DB già migrato e scrive
 * esclusivamente nelle tabelle di ingestion (tracks, playlists,
 * playlist_tracks, cues, ingest_runs) — mai DDL.
 *
 * Writer-ownership per tabella:
 *  - tracks / playlists / playlist_tracks / cues / ingest_runs → scrittore di
 *    ingestion (sidecar Python per master.db, Node per il fallback XML).
 *    I due percorsi non girano mai in concorrenza: Node serializza i job.
 *  - settings / jobs / oplog → SOLO Node.
 */
export const SCHEMA_VERSION = 6;

const MIGRATIONS: Record<number, string> = {
  1: `
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tracks (
      id INTEGER PRIMARY KEY,
      source TEXT NOT NULL CHECK (source IN ('masterdb', 'xml')),
      source_id TEXT,
      title TEXT,
      artist TEXT,
      album TEXT,
      genre TEXT,
      year INTEGER,
      bpm REAL,
      musical_key TEXT,
      camelot TEXT,
      duration_s REAL,
      path TEXT,
      filesize INTEGER,
      file_mtime INTEGER,
      version_label TEXT,
      has_tag_issues INTEGER NOT NULL DEFAULT 0,
      needs_review INTEGER NOT NULL DEFAULT 0,
      review_reason TEXT,
      acoustic_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (source, source_id)
    );
    CREATE INDEX IF NOT EXISTS idx_tracks_path ON tracks(path);
    CREATE INDEX IF NOT EXISTS idx_tracks_artist ON tracks(artist);
    CREATE INDEX IF NOT EXISTS idx_tracks_review ON tracks(needs_review);

    CREATE TABLE IF NOT EXISTS playlists (
      id INTEGER PRIMARY KEY,
      source TEXT NOT NULL CHECK (source IN ('masterdb', 'xml')),
      source_id TEXT,
      name TEXT NOT NULL,
      parent_id INTEGER REFERENCES playlists(id) ON DELETE CASCADE,
      is_folder INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      UNIQUE (source, source_id)
    );

    CREATE TABLE IF NOT EXISTS playlist_tracks (
      playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
      track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      PRIMARY KEY (playlist_id, position)
    );

    CREATE TABLE IF NOT EXISTS cues (
      id INTEGER PRIMARY KEY,
      track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
      cue_type TEXT NOT NULL CHECK (cue_type IN ('hot', 'memory', 'loop')),
      cue_index INTEGER,
      position_ms REAL NOT NULL,
      length_ms REAL,
      color TEXT,
      label TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_cues_track ON cues(track_id);

    CREATE TABLE IF NOT EXISTS ingest_runs (
      id INTEGER PRIMARY KEY,
      source TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      status TEXT NOT NULL DEFAULT 'running',
      track_count INTEGER,
      error TEXT
    );

    -- Tabelle applicative: SOLO Node.
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY,
      kind TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      dry_run INTEGER NOT NULL DEFAULT 1,
      started_at TEXT,
      finished_at TEXT,
      detail TEXT
    );

    CREATE TABLE IF NOT EXISTS oplog (
      id INTEGER PRIMARY KEY,
      ts TEXT NOT NULL DEFAULT (datetime('now')),
      operation TEXT NOT NULL,
      target TEXT,
      outcome TEXT NOT NULL,
      detail TEXT
    );
  `,
  // Fase 2: risultati del matching per fingerprint (scrittore: sidecar Python,
  // comando match-fingerprints). Node li legge per generare l'XML di relocation.
  2: `
    CREATE TABLE IF NOT EXISTS relocation_matches (
      id INTEGER PRIMARY KEY,
      track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
      new_path TEXT NOT NULL,
      method TEXT NOT NULL CHECK (method IN ('filename', 'fingerprint')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (track_id, method)
    );
  `,
  // Fase 3: coda "Nuovi Acquisti" del Sync Daemon (scrittore: SOLO Node).
  // Niente iniezioni nel master.db: da qui esce solo un XML che l'utente
  // importa a mano in Rekordbox.
  3: `
    CREATE TABLE IF NOT EXISTS inbox_items (
      id INTEGER PRIMARY KEY,
      path TEXT NOT NULL UNIQUE,
      title TEXT,
      artist TEXT,
      album TEXT,
      genre TEXT,
      year INTEGER,
      bpm REAL,
      musical_key TEXT,
      camelot TEXT,
      duration_s REAL,
      filesize INTEGER,
      has_tag_issues INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'prepared', 'dismissed')),
      added_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_inbox_status ON inbox_items(status);
  `,
  // Conversione bidirezionale: allarga il vincolo `source` di tracks/playlists
  // per accettare gli import dagli altri software DJ (traktor, virtualdj,
  // engine, serato) oltre a masterdb/xml. SQLite non permette di modificare un
  // CHECK: ricostruiamo le due tabelle SENZA CHECK (il valore è validato in
  // codice). Gli id restano invariati, quindi le FK di cues/playlist_tracks
  // continuano a puntare correttamente. La migrate() gira con foreign_keys OFF
  // (vedi openUdm), così il DROP non fa cascade sui figli.
  4: `
    CREATE TABLE tracks_new (
      id INTEGER PRIMARY KEY,
      source TEXT NOT NULL,
      source_id TEXT,
      title TEXT,
      artist TEXT,
      album TEXT,
      genre TEXT,
      year INTEGER,
      bpm REAL,
      musical_key TEXT,
      camelot TEXT,
      duration_s REAL,
      path TEXT,
      filesize INTEGER,
      file_mtime INTEGER,
      version_label TEXT,
      has_tag_issues INTEGER NOT NULL DEFAULT 0,
      needs_review INTEGER NOT NULL DEFAULT 0,
      review_reason TEXT,
      acoustic_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (source, source_id)
    );
    INSERT INTO tracks_new SELECT * FROM tracks;
    DROP TABLE tracks;
    ALTER TABLE tracks_new RENAME TO tracks;
    CREATE INDEX IF NOT EXISTS idx_tracks_path ON tracks(path);
    CREATE INDEX IF NOT EXISTS idx_tracks_artist ON tracks(artist);
    CREATE INDEX IF NOT EXISTS idx_tracks_review ON tracks(needs_review);

    CREATE TABLE playlists_new (
      id INTEGER PRIMARY KEY,
      source TEXT NOT NULL,
      source_id TEXT,
      name TEXT NOT NULL,
      parent_id INTEGER REFERENCES playlists(id) ON DELETE CASCADE,
      is_folder INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      UNIQUE (source, source_id)
    );
    INSERT INTO playlists_new SELECT * FROM playlists;
    DROP TABLE playlists;
    ALTER TABLE playlists_new RENAME TO playlists;
  `,
  // Cronologia riproduzioni (per il report SIAE). Scrittore: sidecar Python
  // (comando read-history, la legge dal master.db); Node la legge per l'export.
  // Rimpiazzata a ogni lettura (non è storico persistente app-side).
  5: `
    CREATE TABLE IF NOT EXISTS play_history (
      id INTEGER PRIMARY KEY,
      session_id TEXT,
      session_name TEXT,
      session_date TEXT,
      position INTEGER,
      title TEXT,
      artist TEXT,
      album TEXT,
      genre TEXT,
      year INTEGER,
      bpm REAL,
      musical_key TEXT,
      duration_s REAL,
      isrc TEXT,
      label TEXT,
      path TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_history_session ON play_history(session_id);
  `,
  // Metadati di performance trasversali (roadmap §7.5): finora persi in OGNI
  // rotta perché assenti dal modello, non dai formati. gain_db = guadagno/replay-
  // gain in dB; rating 0-100 (normalizzato dalle stelle 0-5 dove serve);
  // track_color = colore della traccia in #RRGGBB; beatgrid_bpm/anchor = primo
  // downbeat per ricostruire una griglia a BPM costante (la griglia a fase
  // variabile completa resta nei file ANLZ/GRID, vedi roadmap §7.10).
  6: `
    ALTER TABLE tracks ADD COLUMN gain_db REAL;
    ALTER TABLE tracks ADD COLUMN rating INTEGER;
    ALTER TABLE tracks ADD COLUMN track_color TEXT;
    ALTER TABLE tracks ADD COLUMN beatgrid_bpm REAL;
    ALTER TABLE tracks ADD COLUMN beatgrid_anchor_ms REAL;
  `
};

export function migrate(db: BetterSqlite3.Database): void {
  const current = getSchemaVersion(db);
  for (let v = current + 1; v <= SCHEMA_VERSION; v++) {
    const sql = MIGRATIONS[v];
    if (!sql) continue;
    const apply = db.transaction(() => {
      db.exec(sql);
      db.prepare(
        `INSERT INTO meta (key, value) VALUES ('schema_version', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      ).run(String(v));
    });
    apply();
  }
}

export function getSchemaVersion(db: BetterSqlite3.Database): number {
  const hasMeta = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'meta'`)
    .get();
  if (!hasMeta) return 0;
  const row = db.prepare(`SELECT value FROM meta WHERE key = 'schema_version'`).get() as
    | { value: string }
    | undefined;
  if (!row) return 0;
  const v = Number(row.value);
  // Mai degradare in silenzio: un valore corrotto farebbe uscire migrate() da
  // NaN+1 <= N (falso) senza applicare nulla e senza errore.
  if (!Number.isInteger(v) || v < 0 || v > SCHEMA_VERSION) {
    throw new Error(`meta.schema_version non valido (${row.value}): database incompatibile o corrotto.`);
  }
  return v;
}
