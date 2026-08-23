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
export const SCHEMA_VERSION = 11;

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
  `,
  /* Identità canonica della traccia.
   *
   * Fino a qui l'identità era `(source, source_id)`: lo STESSO file importato da
   * Rekordbox e da Traktor produceva due righe senza alcun legame fra loro.
   * Finché ogni libreria si guardava da sola non si notava; nel momento in cui
   * si vogliono vedere insieme, la stessa canzone compare due volte e nessuna
   * sincronizzazione fra software è possibile — non c'è modo di dire "questi due
   * sono lo stesso brano".
   *
   * `canonical_id` punta alla riga che rappresenta il file reale. NULL significa
   * "sono io il canonico": è il valore di partenza di tutte le righe già
   * esistenti, che quindi NON vengono toccate dalla migrazione. Le fusioni le fa
   * la regola di identità in core/identity.ts, sui dati nuovi, e sono sempre
   * reversibili perché nessuna riga viene cancellata.
   */
  7: `
    ALTER TABLE tracks ADD COLUMN canonical_id INTEGER REFERENCES tracks(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_tracks_canonical ON tracks(canonical_id);
  `,
  /* Ora di riproduzione del singolo brano.
   *
   * La cronologia aveva una data per SESSIONE e nient'altro: bastava a dire
   * "questa serata", non a dire "dalle 21:00 alle 06:00". Ma una serata non sta
   * dentro un giorno di calendario, e il programma musicale si compila per
   * fascia oraria — quindi l'orario deve stare sulla riga, non sul gruppo.
   *
   * Resta NULL per tutto ciò che è già stato letto e per le cronologie che non
   * lo espongono: chi legge deve trattare l'assenza come "non lo so", mai come
   * "fuori orario". */
  8: `
    ALTER TABLE play_history ADD COLUMN played_at TEXT;
  `,
  /* Sacca dei campi non normalizzati.
   *
   * Ogni formato porta con sé dati che nessuna colonna dell'UDM accoglie:
   * `thirdPartySourceId` di Engine, gli attributi di `<Scan>` che VirtualDJ non
   * dichiara, il numero di slot originale di un cue Rekordbox, la coppia
   * `(location_id, portable_id)` con cui Serato 4 identifica un asset. Finora
   * quei valori venivano letti e buttati via, perché non c'era dove metterli:
   * una conversione X → UDM → X li perdeva in silenzio, e il silenzio è la
   * parte peggiore — l'utente non ha modo di accorgersene.
   *
   * `data` è un oggetto JSON con una chiave per formato:
   *
   *   {"serato4": {"locationId": 1, "portableId": "…"}, "engine": {…}}
   *
   * La convenzione è obbligatoria: chi scrive dentro `data` tocca SOLO la
   * propria chiave di primo livello e lascia intatte le altre. Senza, due
   * adapter che scrivono lo stesso brano si cancellano i dati a vicenda.
   *
   * Perché JSON e non colonne: le colonne servono a ciò su cui si interroga o
   * si ordina. Qui si tratta di valori che si conservano per riconsegnarli
   * identici al formato da cui vengono — normalizzarli significherebbe
   * aggiungere una colonna per ogni software, e ricominciare al successivo.
   *
   * Il default `'{}'` vale anche per le righe già esistenti, che quindi non
   * vengono toccate: nessuna riscrittura, nessuna perdita.
   */
  9: `
    ALTER TABLE tracks ADD COLUMN data TEXT NOT NULL DEFAULT '{}';
    ALTER TABLE cues   ADD COLUMN data TEXT NOT NULL DEFAULT '{}';
  `,
  /* Volume, percorso relativo, e il perche' di un collegamento.
   *
   * Tre problemi che sembrano distinti e sono lo stesso.
   *
   * 1. IDENTITA' FRA MACCHINE. L'identita' di un file era il percorso intero.
   *    Ma i formati DJ non ragionano cosi': Serato <=3 scrive un percorso
   *    RELATIVO alla radice del volume, Serato 4 identifica per
   *    (location_id, portable_id). Una chiavetta montata come E: su un computer
   *    e F: su un altro e' lo stesso supporto con due percorsi diversi, e oggi
   *    produce due identita' diverse.
   *
   * 2. DRIVE ASSENTE CONTRO FILE CANCELLATI. Senza la nozione di volume le due
   *    cose si assomigliano troppo, e confonderle in un motore di
   *    sincronizzazione significa propagare una cancellazione che nessuno ha
   *    chiesto. E' il modo piu' diretto di distruggere una libreria.
   *
   * 3. PERCHE' DUE RIGHE SONO UNITE. La regola di identita' ha tre gradini di
   *    certezza decrescente, ma la riga non registrava quale l'aveva collegata.
   *    Serve per due motivi diversi: la fiducia in un collegamento per impronta
   *    acustica non e' quella di uno per percorso identico, e all'utente che
   *    chiede «perche' questi due sono lo stesso brano?» oggi non si sa
   *    rispondere.
   *
   * `identity_overrides` chiude il cerchio: se la regola sbaglia, l'utente deve
   * poter dire «no, sono brani diversi» PRIMA che un motore automatico ci
   * scriva sopra. Il verdetto e' un puntatore, quindi sempre annullabile.
   */
  10: `
    CREATE TABLE IF NOT EXISTS volumes (
      id           INTEGER PRIMARY KEY,
      -- Identificatore stabile del supporto, quando ricavabile (uuid del
      -- filesystem, serial number). NULL quando non lo si e' potuto leggere:
      -- allora si ripiega su label + mount point, che e' piu' debole.
      uuid         TEXT UNIQUE,
      label        TEXT,
      -- Ultimo punto di innesto visto: cambia fra macchine, e' un indizio non
      -- un'identita'.
      last_mount   TEXT,
      last_seen_at TEXT,
      removable    INTEGER NOT NULL DEFAULT 0
    );

    ALTER TABLE tracks ADD COLUMN volume_id INTEGER REFERENCES volumes(id) ON DELETE SET NULL;
    ALTER TABLE tracks ADD COLUMN path_relative TEXT;
    CREATE INDEX IF NOT EXISTS idx_tracks_volume ON tracks(volume_id, path_relative);

    -- Quale regola ha collegato questa riga al proprio canonico, e quando.
    -- NULL = «sono io il canonico», che e' lo stato di tutte le righe esistenti.
    ALTER TABLE tracks ADD COLUMN identity_rule TEXT;
    ALTER TABLE tracks ADD COLUMN identity_at TEXT;

    CREATE TABLE IF NOT EXISTS identity_overrides (
      a_id    INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
      b_id    INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
      -- 'same'      = uniscili anche se la regola non li avrebbe uniti
      -- 'different' = NON unirli, anche se la regola lo farebbe
      verdict TEXT NOT NULL CHECK (verdict IN ('same', 'different')),
      decided_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (a_id, b_id)
    );
  `,
  /* Stato della sincronizzazione, e conflitti in sospeso.
   *
   * ⚠ `last_synced_digest` e' il cuore, ed e' la colonna che sembra
   * ridondante e non lo e': conserva lo stato all'ultimo allineamento
   * RIUSCITO, non quello attuale. Confrontare due librerie dice che sono
   * diverse; non dice CHI ha cambiato. Senza uno stato di riferimento ogni
   * differenza sembra un conflitto, e l'utente annega in domande a cui non sa
   * rispondere.
   *
   * La chiave e' `canonical_id`, non `tracks.id`: l'unita' della
   * sincronizzazione e' il brano reale, non la riga che per caso lo
   * rappresentava in un certo momento.
   */
  11: `
    CREATE TABLE IF NOT EXISTS sync_state (
      canonical_id       INTEGER NOT NULL,
      software           TEXT    NOT NULL,
      -- Il segnale con cui quel software dichiara le proprie modifiche:
      -- numero di sequenza per Rekordbox, timestamp per Serato 4 / Engine /
      -- Traktor, impronta del contenuto per gli altri.
      last_signal        TEXT,
      last_synced_digest TEXT,
      last_synced_at     TEXT,
      outcome            TEXT,
      PRIMARY KEY (canonical_id, software)
    );
    CREATE INDEX IF NOT EXISTS idx_sync_state_software
      ON sync_state(software, last_synced_at);

    CREATE TABLE IF NOT EXISTS sync_conflicts (
      id           INTEGER PRIMARY KEY,
      canonical_id INTEGER NOT NULL,
      -- 'genre' | 'bpm' | 'cues' | 'playlist:<id>' …
      field        TEXT NOT NULL,
      a_software   TEXT NOT NULL,
      a_value      TEXT,
      b_software   TEXT NOT NULL,
      b_value      TEXT,
      detected_at  TEXT NOT NULL DEFAULT (datetime('now')),
      resolved_at  TEXT,
      -- 'a' | 'b' | 'skip'; NULL finche' l'utente non decide
      resolution   TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_sync_conflicts_open
      ON sync_conflicts(canonical_id) WHERE resolved_at IS NULL;
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
