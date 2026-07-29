import type BetterSqlite3 from 'better-sqlite3';
import { toCamelot } from './camelot';
import { extractVersionLabel } from './versionRegex';
import { hasSuspectEncoding } from './xmlCollection';

/**
 * Modello normalizzato per l'import da un software DJ diverso da Rekordbox
 * (Traktor, VirtualDJ, Engine DJ, Serato…). Ogni reader converte il proprio
 * formato in `ForeignLibrary`; `importForeignLibrary` la parcheggia nell'UDM
 * — l'hub universale — con un `source` dedicato, così le conversioni verso
 * qualsiasi altro formato passano dallo stesso modello dati.
 */

export type ForeignSource = 'traktor' | 'virtualdj' | 'engine' | 'serato';

export interface NormCue {
  type: 'hot' | 'memory' | 'loop';
  index: number | null;
  positionMs: number;
  lengthMs: number | null;
  color: string | null;
  label: string | null;
}

export interface NormTrack {
  sourceId: string;
  title: string | null;
  artist: string | null;
  album: string | null;
  genre: string | null;
  year: number | null;
  bpm: number | null;
  musicalKey: string | null;
  durationS: number | null;
  path: string | null;
  filesize: number | null;
  cues: NormCue[];
  // Metadati di performance (roadmap §7.5). Opzionali: gli adapter che non li
  // hanno lasciano undefined → NULL nell'UDM (nessuna regressione).
  gainDb?: number | null;
  rating?: number | null;
  trackColor?: string | null;
  beatgridBpm?: number | null;
  beatgridAnchorMs?: number | null;
}

export interface NormPlaylist {
  sourceId: string;
  name: string;
  isFolder: boolean;
  parentSourceId: string | null;
  /** sourceId dei brani, in ordine (ignorato per le cartelle) */
  trackSourceIds: string[];
}

export interface ForeignLibrary {
  source: ForeignSource;
  tracks: NormTrack[];
  playlists: NormPlaylist[];
  /** avvisi non fatali dal parsing (es. cue ignorati, campi mancanti) */
  warnings: string[];
}

export interface ForeignImportResult {
  tracks: number;
  playlists: number;
  cues: number;
  skipped: number;
  warnings: string[];
}

export type ProgressFn = (done: number, total: number) => void;

/**
 * Scrive una libreria normalizzata nell'UDM. Idempotente per (source,
 * source_id): re-importare aggiorna. Rimpiazza cue e playlist della stessa
 * `source` (non tocca gli altri software importati).
 */
export function importForeignLibrary(
  db: BetterSqlite3.Database,
  lib: ForeignLibrary,
  onProgress?: ProgressFn
): ForeignImportResult {
  const result: ForeignImportResult = {
    tracks: 0,
    playlists: 0,
    cues: 0,
    skipped: 0,
    warnings: [...lib.warnings]
  };

  const runId = db
    .prepare(`INSERT INTO ingest_runs (source, started_at) VALUES (?, datetime('now'))`)
    .run(lib.source).lastInsertRowid;

  const insertTrack = db.prepare(`
    INSERT INTO tracks (source, source_id, title, artist, album, genre, year, bpm,
                        musical_key, camelot, duration_s, path, filesize, version_label,
                        has_tag_issues, needs_review, review_reason,
                        gain_db, rating, track_color, beatgrid_bpm, beatgrid_anchor_ms)
    VALUES (@source, @source_id, @title, @artist, @album, @genre, @year, @bpm,
            @musical_key, @camelot, @duration_s, @path, @filesize, @version_label,
            @has_tag_issues, @needs_review, @review_reason,
            @gain_db, @rating, @track_color, @beatgrid_bpm, @beatgrid_anchor_ms)
    ON CONFLICT(source, source_id) DO UPDATE SET
      title = excluded.title, artist = excluded.artist, album = excluded.album,
      genre = excluded.genre, year = excluded.year, bpm = excluded.bpm,
      musical_key = excluded.musical_key, camelot = excluded.camelot,
      duration_s = excluded.duration_s, path = excluded.path,
      filesize = excluded.filesize, version_label = excluded.version_label,
      has_tag_issues = excluded.has_tag_issues, needs_review = excluded.needs_review,
      review_reason = excluded.review_reason,
      gain_db = excluded.gain_db, rating = excluded.rating,
      track_color = excluded.track_color, beatgrid_bpm = excluded.beatgrid_bpm,
      beatgrid_anchor_ms = excluded.beatgrid_anchor_ms
  `);
  const getId = db.prepare(`SELECT id FROM tracks WHERE source = ? AND source_id = ?`);
  const deleteCues = db.prepare(`DELETE FROM cues WHERE track_id = ?`);
  const insertCue = db.prepare(`
    INSERT INTO cues (track_id, cue_type, cue_index, position_ms, length_ms, color, label)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const idBySourceId = new Map<string, number>();
  const BATCH = 500;
  for (let i = 0; i < lib.tracks.length; i += BATCH) {
    const slice = lib.tracks.slice(i, i + BATCH);
    const tx = db.transaction(() => {
      for (const t of slice) {
        if (!t.sourceId) {
          result.skipped++;
          continue;
        }
        const tagIssue = !t.title || !t.artist;
        const badEncoding = hasSuspectEncoding(t.title) || hasSuspectEncoding(t.artist);
        insertTrack.run({
          source: lib.source,
          source_id: t.sourceId,
          title: t.title,
          artist: t.artist,
          album: t.album,
          genre: t.genre,
          year: t.year,
          bpm: t.bpm,
          musical_key: t.musicalKey,
          camelot: toCamelot(t.musicalKey),
          duration_s: t.durationS,
          path: t.path,
          filesize: t.filesize,
          version_label:
            extractVersionLabel(t.title ?? '') || extractVersionLabel(t.path ?? ''),
          has_tag_issues: tagIssue ? 1 : 0,
          needs_review: badEncoding ? 1 : 0,
          review_reason: badEncoding ? 'Tag con caratteri sospetti o corrotti' : null,
          gain_db: t.gainDb ?? null,
          rating: t.rating ?? null,
          track_color: t.trackColor ?? null,
          beatgrid_bpm: t.beatgridBpm ?? null,
          beatgrid_anchor_ms: t.beatgridAnchorMs ?? null
        });
        const row = getId.get(lib.source, t.sourceId) as { id: number } | undefined;
        if (!row) {
          result.skipped++;
          continue;
        }
        idBySourceId.set(t.sourceId, row.id);
        result.tracks++;

        deleteCues.run(row.id);
        for (const c of t.cues) {
          if (Number.isNaN(c.positionMs)) continue;
          insertCue.run(row.id, c.type, c.index, c.positionMs, c.lengthMs, c.color, c.label);
          result.cues++;
        }
      }
    });
    tx();
    onProgress?.(Math.min(i + BATCH, lib.tracks.length), lib.tracks.length);
  }

  // Playlist: rimpiazza quelle della stessa source, poi ricostruisce l'albero.
  const tx = db.transaction(() => {
    db.prepare(
      `DELETE FROM playlist_tracks WHERE playlist_id IN (SELECT id FROM playlists WHERE source = ?)`
    ).run(lib.source);
    db.prepare(`DELETE FROM playlists WHERE source = ?`).run(lib.source);

    const insertPl = db.prepare(
      `INSERT INTO playlists (source, source_id, name, parent_id, is_folder, sort_order)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    const insertPt = db.prepare(
      `INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)`
    );
    const plIdBySourceId = new Map<string, number>();

    // Ordina padri prima dei figli: le cartelle senza parent per prime.
    const ordered = [...lib.playlists].sort(
      (a, b) => (a.parentSourceId ? 1 : 0) - (b.parentSourceId ? 1 : 0)
    );
    let sort = 0;
    for (const p of ordered) {
      const parentId = p.parentSourceId ? plIdBySourceId.get(p.parentSourceId) ?? null : null;
      const info = insertPl.run(
        lib.source,
        p.sourceId,
        p.name,
        parentId,
        p.isFolder ? 1 : 0,
        sort++
      );
      const plId = Number(info.lastInsertRowid);
      plIdBySourceId.set(p.sourceId, plId);
      result.playlists++;
      if (!p.isFolder) {
        let pos = 0;
        for (const sid of p.trackSourceIds) {
          const tid = idBySourceId.get(sid);
          if (tid !== undefined) insertPt.run(plId, tid, pos++);
        }
      }
    }
  });
  tx();

  db.prepare(
    `UPDATE ingest_runs SET finished_at = datetime('now'), status = 'ok', track_count = ? WHERE id = ?`
  ).run(result.tracks, runId);

  return result;
}
