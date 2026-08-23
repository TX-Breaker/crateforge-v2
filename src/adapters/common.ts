import type BetterSqlite3 from 'better-sqlite3';
import type { TrackRow } from '@core/udm';
import { DEST_CAPABILITY, resolveCues, type SyncMode } from '@core/sync';

export interface CueRow {
  id: number;
  track_id: number;
  cue_type: 'hot' | 'memory' | 'loop';
  cue_index: number | null;
  position_ms: number;
  length_ms: number | null;
  color: string | null;
  label: string | null;
  /** Sacca dei campi non normalizzati; vedi `core/formatData`. */
  data?: string;
}

export interface PlaylistRow {
  id: number;
  name: string;
  parent_id: number | null;
  is_folder: number;
  sort_order: number;
}

export interface ExportSelection {
  /** id playlist da esportare; vuoto = tutte */
  playlistIds?: number[];
  /** limita l'export ai brani/playlist di questa sorgente (per conversione X→Y);
   *  vuoto = tutta la libreria UDM (hub) */
  source?: string;
  /**
   * Sincronizzazione: i punti arrivano da un'altra libreria dello stesso brano,
   * con la regola di risoluzione dei conflitti. Assente = ogni riga porta i
   * propri.
   */
  sync?: SyncSelection;
}

/** Limiti del canale XML Rekordbox (§4): da mostrare PRIMA di ogni export. */
export const REKORDBOX_XML_LIMITS = [
  "L'import XML aggiunge/aggiorna i brani ma NON rimuove nulla dalla collection.",
  'Vengono importate al massimo 8 hot cue per brano.',
  'I colori delle memory cue, i MyTag e le smartlist NON passano.',
  'I loop attivi NON passano.',
  "L'import finale in Rekordbox è manuale: dovrai cliccare tu 'Import to Collection'."
] as const;

const PAGE = 1000;

/** Itera i brani a pagine (mai tutta la libreria in un array). */
export function* iterateTracks(
  db: BetterSqlite3.Database,
  sel: ExportSelection
): Generator<TrackRow> {
  const conds: string[] = [];
  const params: unknown[] = [];
  if (sel.source) {
    conds.push('t.source = ?');
    params.push(sel.source);
  }
  if (sel.playlistIds && sel.playlistIds.length > 0) {
    conds.push(
      `t.id IN (SELECT track_id FROM playlist_tracks WHERE playlist_id IN (${sel.playlistIds
        .map(() => '?')
        .join(',')}))`
    );
    params.push(...sel.playlistIds);
  }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const total = (
    db.prepare(`SELECT COUNT(*) AS c FROM tracks t ${where}`).get(...params) as { c: number }
  ).c;
  const stmt = db.prepare(`SELECT t.* FROM tracks t ${where} ORDER BY t.id LIMIT ? OFFSET ?`);
  for (let offset = 0; offset < total; offset += PAGE) {
    for (const row of stmt.all(...params, PAGE, offset) as TrackRow[]) {
      yield row;
    }
  }
}

/**
 * Sincronizzazione richiesta per questo export: i punti non arrivano dalla riga
 * che si sta scrivendo, ma da un'altra libreria dello STESSO brano reale.
 */
export interface SyncSelection {
  /** valori di `tracks.source` da cui prendere i punti */
  originSources: string[];
  /** software che riceve, per sapere quanti pad ha e se sa retrocedere */
  destination: string;
  mode: SyncMode;
}

export function getCuesForTrack(
  db: BetterSqlite3.Database,
  trackId: number,
  sync?: SyncSelection
): CueRow[] {
  const own = db
    .prepare(`SELECT * FROM cues WHERE track_id = ? ORDER BY cue_type, cue_index, position_ms`)
    .all(trackId) as CueRow[];
  if (!sync) return own;

  /* In sincronizzazione i punti arrivano dalla libreria di origine, per lo
     stesso brano reale: è per questo che esiste l'identità canonica. Se il
     brano non esiste nell'origine non c'è niente da portare, e la riga resta
     con i suoi punti — mai svuotata. */
  const originRows = db
    .prepare(
      `SELECT o.id FROM tracks o
         JOIN tracks d ON COALESCE(o.canonical_id, o.id) = COALESCE(d.canonical_id, d.id)
        WHERE d.id = ? AND o.id <> d.id
          AND o.source IN (${sync.originSources.map(() => '?').join(',')})`
    )
    .all(trackId, ...sync.originSources) as { id: number }[];
  if (originRows.length === 0) return own;

  const stmt = db.prepare(
    `SELECT * FROM cues WHERE track_id = ? ORDER BY cue_type, cue_index, position_ms`
  );
  const origin = originRows.flatMap((r) => stmt.all(r.id) as CueRow[]);
  const cap = DEST_CAPABILITY[sync.destination];
  if (!cap) return own;

  const resolved = resolveCues(origin, own, sync.mode, cap);
  // I writer leggono solo i campi del punto: id e track_id non servono loro.
  return resolved.cues.map((c, i) => ({
    id: -1 - i,
    track_id: trackId,
    cue_type: c.cue_type,
    cue_index: c.cue_index,
    position_ms: c.position_ms,
    length_ms: c.length_ms,
    color: c.color,
    label: c.label,
    data: c.data
  }));
}

export function getPlaylists(db: BetterSqlite3.Database, sel: ExportSelection): PlaylistRow[] {
  if (sel.playlistIds && sel.playlistIds.length > 0) {
    const q = `SELECT id, name, parent_id, is_folder, sort_order FROM playlists
               WHERE id IN (${sel.playlistIds.map(() => '?').join(',')}) ORDER BY sort_order`;
    return db.prepare(q).all(...sel.playlistIds) as PlaylistRow[];
  }
  if (sel.source) {
    return db
      .prepare(
        `SELECT id, name, parent_id, is_folder, sort_order FROM playlists WHERE source = ? ORDER BY sort_order`
      )
      .all(sel.source) as PlaylistRow[];
  }
  return db
    .prepare(`SELECT id, name, parent_id, is_folder, sort_order FROM playlists ORDER BY sort_order`)
    .all() as PlaylistRow[];
}

export function getPlaylistTrackIds(db: BetterSqlite3.Database, playlistId: number): number[] {
  return (
    db
      .prepare(`SELECT track_id FROM playlist_tracks WHERE playlist_id = ? ORDER BY position`)
      .all(playlistId) as { track_id: number }[]
  ).map((r) => r.track_id);
}

/** C:\Music\a.mp3 → file://localhost/C:/Music/a.mp3 ; /Users/x/a.mp3 → file://localhost/Users/x/a.mp3 */
export function pathToLocation(p: string): string {
  const posix = p.replace(/\\/g, '/');
  const encoded = posix
    .split('/')
    // Il drive letter "C:" NON va percent-encodato (diventerebbe "C%3A" e
    // Rekordbox non risolverebbe il file su Windows all'import).
    .map((seg, i) => (i === 0 && /^[A-Za-z]:$/.test(seg) ? seg : encodeURIComponent(seg).replace(/'/g, '%27')))
    .join('/');
  return `file://localhost/${encoded.replace(/^\//, '')}`;
}

/** Estensione file → 'Kind' Rekordbox (MP3 File, FLAC File, …). */
export function kindFromPath(p: string | null): string {
  const ext = (p?.match(/\.([a-z0-9]+)$/i)?.[1] ?? '').toLowerCase();
  const map: Record<string, string> = {
    mp3: 'MP3 File', flac: 'FLAC File', wav: 'WAV File', aiff: 'AIFF File',
    aif: 'AIFF File', m4a: 'M4A File', aac: 'AAC File', ogg: 'OGG File',
    alac: 'ALAC File', wma: 'WMA File'
  };
  return map[ext] ?? 'MP3 File';
}
