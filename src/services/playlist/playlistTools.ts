import type BetterSqlite3 from 'better-sqlite3';
import { existsSync } from 'fs';

/**
 * Strumenti per le playlist dell'archivio, usati dalla schermata Playlist.
 *
 * Le playlist qui dentro sono quelle dei PROGRAMMI, portate nell'archivio
 * dagli import: la schermata non mantiene una lista sua. Ogni strumento lavora
 * read-only sull'origine e scrive, quando serve, solo nell'archivio (dedupe) o
 * in un file nuovo scelto dall'utente (export).
 */

export interface PlaylistRow {
  id: number;
  name: string;
  isFolder: boolean;
  /** Nome della cartella che la contiene, se c'è. */
  parentName: string | null;
  trackCount: number;
  /** Da dove arriva: il source della tabella playlists («masterdb», «xml»). */
  source: string;
}

export function listPlaylistsFull(db: BetterSqlite3.Database): PlaylistRow[] {
  const rows = db
    .prepare(
      `SELECT p.id, p.name, p.is_folder AS isFolder, parent.name AS parentName,
              p.source AS source, COUNT(pt.track_id) AS trackCount
         FROM playlists p
         LEFT JOIN playlists parent ON parent.id = p.parent_id
         LEFT JOIN playlist_tracks pt ON pt.playlist_id = p.id
        GROUP BY p.id
        ORDER BY p.is_folder DESC, parent.name, p.sort_order, p.name`
    )
    .all() as (Omit<PlaylistRow, 'isFolder'> & { isFolder: number })[];
  /* SQLite dà 0/1: l'interfaccia promette un booleano, e la menzogna di un
     cast la pagherebbe chi scrive `if (p.isFolder === false)`. */
  return rows.map((r) => ({ ...r, isFolder: r.isFolder !== 0 }));
}

export interface DetailTrack {
  id: number;
  position: number;
  title: string | null;
  artist: string | null;
  album: string | null;
  genre: string | null;
  bpm: number | null;
  camelot: string | null;
  durationS: number | null;
  path: string | null;
  /** Il file non è raggiungibile al percorso registrato. */
  missing: boolean;
}

export interface PlaylistDetail {
  name: string;
  tracks: DetailTrack[];
  stats: {
    durationS: number;
    bpmMin: number | null;
    bpmMax: number | null;
    /** Le tre tonalità più frequenti, in Camelot. */
    keys: { key: string; n: number }[];
  };
}

export function playlistDetail(
  db: BetterSqlite3.Database,
  playlistId: number,
  /** Verifica di esistenza iniettabile (nei test non si tocca il disco). */
  exists: (p: string) => boolean = existsSync
): PlaylistDetail | null {
  const name = db.prepare(`SELECT name FROM playlists WHERE id = ?`).get(playlistId) as
    | { name: string }
    | undefined;
  if (!name) return null;

  const rows = db
    .prepare(
      `SELECT t.id, pt.position, t.title, t.artist, t.album, t.genre, t.bpm, t.camelot,
              t.path, t.duration_s AS durationS
         FROM playlist_tracks pt
         JOIN tracks t ON t.id = pt.track_id
        WHERE pt.playlist_id = ?
        ORDER BY pt.position`
    )
    .all(playlistId) as (DetailTrack & { missing?: boolean })[];

  const tracks: DetailTrack[] = rows.map((r) => ({
    ...r,
    missing: r.path == null || !exists(r.path)
  }));

  const bpmValues = tracks.map((t) => t.bpm).filter((b): b is number => b != null && b > 0);
  const keyCount = new Map<string, number>();
  for (const t of tracks) {
    if (t.camelot) keyCount.set(t.camelot, (keyCount.get(t.camelot) ?? 0) + 1);
  }
  const keys = [...keyCount.entries()]
    .map(([key, n]) => ({ key, n }))
    .sort((a, b) => b.n - a.n)
    .slice(0, 3);

  return {
    name: name.name,
    tracks,
    stats: {
      durationS: rows.reduce((s, r) => s + (r.durationS ?? 0), 0),
      bpmMin: bpmValues.length ? Math.min(...bpmValues) : null,
      bpmMax: bpmValues.length ? Math.max(...bpmValues) : null,
      keys
    }
  };
}

/**
 * Toglie i doppioni CONSECUTIVI (lo stesso brano ripetuto di fila, tipico di un
 * export andato due volte). I doppioni non consecutivi restano: lì può essere
 * una scelta dell'utente, non un errore. Le posizioni si riserrano dopo.
 */
export function dedupeConsecutive(db: BetterSqlite3.Database, playlistId: number): number {
  const rows = db
    .prepare(`SELECT track_id FROM playlist_tracks WHERE playlist_id = ? ORDER BY position`)
    .all(playlistId) as { track_id: number }[];
  const keep: number[] = [];
  for (const r of rows) {
    if (keep.length === 0 || keep[keep.length - 1] !== r.track_id) keep.push(r.track_id);
  }
  const removed = rows.length - keep.length;
  if (removed === 0) return 0;

  const run = db.transaction(() => {
    db.prepare(`DELETE FROM playlist_tracks WHERE playlist_id = ?`).run(playlistId);
    const ins = db.prepare(
      `INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)`
    );
    keep.forEach((trackId, i) => ins.run(playlistId, trackId, i));
  });
  run();
  return removed;
}

/** M3U8 (UTF-8) con i soli brani che hanno un percorso. */
export function buildM3u(tracks: DetailTrack[], playlistName: string): string {
  const lines = ['#EXTM3U', `#PLAYLIST:${playlistName}`];
  for (const t of tracks) {
    if (!t.path) continue;
    const sec = t.durationS != null && t.durationS > 0 ? Math.round(t.durationS) : -1;
    lines.push(`#EXTINF:${sec},${t.artist ?? ''} - ${t.title ?? ''}`);
    lines.push(t.path);
  }
  return lines.join('\r\n') + '\r\n';
}

/** CSV con BOM e separatore «;»: Excel lo apre corretto senza passaggi manuali. */
export function buildCsv(tracks: DetailTrack[]): string {
  const esc = (v: string | number | null): string => {
    const s = v == null ? '' : String(v);
    return /[",;\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = ['Posizione', 'Titolo', 'Artista', 'Album', 'Genere', 'BPM', 'Tonalità', 'Percorso'];
  const body = tracks.map((t) =>
    [
      t.position,
      t.title,
      t.artist,
      t.album,
      t.genre,
      t.bpm != null ? t.bpm.toFixed(2) : '',
      t.camelot ?? '',
      t.path ?? ''
    ]
      .map(esc)
      .join(';')
  );
  return '\uFEFF' + [head.map(esc).join(';'), ...body].join('\r\n') + '\r\n';
}
