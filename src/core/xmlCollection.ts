import { XMLParser } from 'fast-xml-parser';
import { readFileSync } from 'fs';
import type BetterSqlite3 from 'better-sqlite3';
import { extractVersionLabel } from './versionRegex';
import { toCamelot } from './camelot';

/**
 * Ingestion "pure-Node" dal collection XML esportato manualmente da Rekordbox
 * (modalità solo-XML / fallback quando master.db non è leggibile).
 *
 * Scrive nelle tabelle di ingestion con source='xml'. Non gira mai in
 * concorrenza con l'ingestion del sidecar (Node serializza i job).
 */

export interface XmlIngestResult {
  tracks: number;
  playlists: number;
  cues: number;
  skipped: number;
}

export type ProgressFn = (done: number, total: number) => void;

interface RbTrack {
  '@_TrackID': string;
  '@_Name'?: string;
  '@_Artist'?: string;
  '@_Album'?: string;
  '@_Genre'?: string;
  '@_Year'?: string;
  '@_AverageBpm'?: string;
  '@_Tonality'?: string;
  '@_TotalTime'?: string;
  '@_Location'?: string;
  '@_Size'?: string;
  '@_Mix'?: string;
  POSITION_MARK?: unknown;
  TEMPO?: unknown;
}

/** Primo marker <TEMPO> (downbeat + BPM della beatgrid) da un TRACK dell'XML. */
function firstTempo(t: RbTrack): { anchorMs: number | null; bpm: number | null } {
  const tempos = asArray<Record<string, string>>(
    t.TEMPO as Record<string, string> | Record<string, string>[] | undefined
  );
  if (!tempos.length) return { anchorMs: null, bpm: null };
  const first = tempos[0];
  const inizio = Number(first['@_Inizio']);
  const bpm = Number(first['@_Bpm']);
  return {
    anchorMs: Number.isFinite(inizio) ? inizio * 1000 : null,
    bpm: Number.isFinite(bpm) && bpm > 0 ? bpm : null
  };
}

function asArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

/** file://localhost/C:/Music/a.mp3 → C:\Music\a.mp3 (o percorso POSIX su mac) */
export function locationToPath(location: string | undefined): string | null {
  if (!location) return null;
  let p = location.replace(/^file:\/\/localhost\//, '').replace(/^file:\/\//, '');
  try {
    p = decodeURIComponent(p);
  } catch {
    // percent-encoding corrotto: tieni il valore grezzo
  }
  if (/^[A-Za-z]:\//.test(p)) return p.replace(/\//g, '\\');
  return p.startsWith('/') ? p : `/${p}`;
}

export function ingestCollectionXml(
  db: BetterSqlite3.Database,
  xmlPath: string,
  onProgress?: ProgressFn
): XmlIngestResult {
  const xml = readFileSync(xmlPath, 'utf-8');
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    parseAttributeValue: false
  });
  const doc = parser.parse(xml);
  const collection = doc?.DJ_PLAYLISTS?.COLLECTION;
  if (!collection) {
    throw new Error('File XML non valido: manca DJ_PLAYLISTS/COLLECTION');
  }
  const tracks = asArray<RbTrack>(collection.TRACK);
  const result: XmlIngestResult = { tracks: 0, playlists: 0, cues: 0, skipped: 0 };

  const runId = db
    .prepare(`INSERT INTO ingest_runs (source, started_at) VALUES ('xml', datetime('now'))`)
    .run().lastInsertRowid;

  const insertTrack = db.prepare(`
    INSERT INTO tracks (source, source_id, title, artist, album, genre, year, bpm,
                        musical_key, camelot, duration_s, path, filesize, version_label,
                        has_tag_issues, needs_review, review_reason,
                        beatgrid_bpm, beatgrid_anchor_ms)
    VALUES ('xml', @source_id, @title, @artist, @album, @genre, @year, @bpm,
            @musical_key, @camelot, @duration_s, @path, @filesize, @version_label,
            @has_tag_issues, @needs_review, @review_reason,
            @beatgrid_bpm, @beatgrid_anchor_ms)
    ON CONFLICT(source, source_id) DO UPDATE SET
      title = excluded.title, artist = excluded.artist, album = excluded.album,
      genre = excluded.genre, year = excluded.year, bpm = excluded.bpm,
      musical_key = excluded.musical_key, camelot = excluded.camelot,
      duration_s = excluded.duration_s, path = excluded.path,
      filesize = excluded.filesize, version_label = excluded.version_label,
      has_tag_issues = excluded.has_tag_issues, needs_review = excluded.needs_review,
      review_reason = excluded.review_reason,
      beatgrid_bpm = excluded.beatgrid_bpm, beatgrid_anchor_ms = excluded.beatgrid_anchor_ms
  `);
  const trackIdBySourceId = new Map<string, number>();
  const getId = db.prepare(`SELECT id FROM tracks WHERE source = 'xml' AND source_id = ?`);
  const deleteCues = db.prepare(
    `DELETE FROM cues WHERE track_id = (SELECT id FROM tracks WHERE source = 'xml' AND source_id = ?)`
  );
  const insertCue = db.prepare(`
    INSERT INTO cues (track_id, cue_type, cue_index, position_ms, length_ms, color, label)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  // Batch in transazioni brevi (mai un'unica transazione monstre né riga-per-riga autocommit).
  const BATCH = 500;
  for (let i = 0; i < tracks.length; i += BATCH) {
    const slice = tracks.slice(i, i + BATCH);
    const tx = db.transaction(() => {
      for (const t of slice) {
        const sourceId = t['@_TrackID'];
        if (!sourceId) {
          result.skipped++;
          continue;
        }
        const title = t['@_Name'] ?? null;
        const path = locationToPath(t['@_Location']);
        const tagIssue = !title || !t['@_Artist'];
        const badEncoding = hasSuspectEncoding(title) || hasSuspectEncoding(t['@_Artist']);
        insertTrack.run({
          source_id: sourceId,
          title,
          artist: t['@_Artist'] ?? null,
          album: t['@_Album'] ?? null,
          genre: t['@_Genre'] ?? null,
          year: t['@_Year'] ? Number(t['@_Year']) || null : null,
          bpm: t['@_AverageBpm'] ? Number(t['@_AverageBpm']) || null : null,
          musical_key: t['@_Tonality'] ?? null,
          camelot: toCamelot(t['@_Tonality']),
          duration_s: t['@_TotalTime'] ? Number(t['@_TotalTime']) || null : null,
          path,
          filesize: t['@_Size'] ? Number(t['@_Size']) || null : null,
          version_label:
            t['@_Mix'] || extractVersionLabel(title ?? '') || extractVersionLabel(path ?? ''),
          has_tag_issues: tagIssue ? 1 : 0,
          needs_review: badEncoding ? 1 : 0,
          review_reason: badEncoding ? 'Tag con caratteri sospetti o corrotti' : null,
          // Beatgrid reale: primo marker TEMPO (downbeat + BPM). Prima veniva
          // ignorata e l'export ri-sintetizzava una griglia piatta ancorata a 0.
          ...(() => {
            const g = firstTempo(t);
            return { beatgrid_bpm: g.bpm, beatgrid_anchor_ms: g.anchorMs };
          })()
        });
        const row = getId.get(sourceId) as { id: number } | undefined;
        if (row) trackIdBySourceId.set(sourceId, row.id);
        result.tracks++;

        deleteCues.run(sourceId);
        for (const mark of asArray<Record<string, string>>(
          t.POSITION_MARK as Record<string, string> | Record<string, string>[] | undefined
        )) {
          const num = Number(mark['@_Num']);
          const start = Number(mark['@_Start']) * 1000;
          const end = mark['@_End'] !== undefined ? Number(mark['@_End']) * 1000 : null;
          const color = rgbAttrs(mark);
          const trackId = trackIdBySourceId.get(sourceId);
          if (trackId === undefined || Number.isNaN(start)) continue;
          insertCue.run(
            trackId,
            end !== null ? 'loop' : num >= 0 ? 'hot' : 'memory',
            num >= 0 ? num : null,
            start,
            end !== null && !Number.isNaN(end) ? end - start : null,
            color,
            mark['@_Name'] || null
          );
          result.cues++;
        }
      }
    });
    tx();
    onProgress?.(Math.min(i + BATCH, tracks.length), tracks.length);
  }

  // Playlist (albero NODE)
  const playlistsRoot = doc?.DJ_PLAYLISTS?.PLAYLISTS?.NODE;
  if (playlistsRoot) {
    const tx = db.transaction(() => {
      db.exec(`DELETE FROM playlist_tracks WHERE playlist_id IN (SELECT id FROM playlists WHERE source='xml');
               DELETE FROM playlists WHERE source='xml';`);
      // In DJ_PLAYLISTS il nodo di primo livello è il contenitore tecnico ROOT
      // (Type=0, Name="ROOT") — sia negli export di rekordbox sia in quelli
      // scritti da noi. Va scavalcato iterando direttamente i suoi figli, altrimenti
      // il round-trip aggiunge un folder "ROOT" fantasma (albero non idempotente,
      // come per $ROOT in Traktor: nmlReader).
      for (const top of asArray(playlistsRoot)) {
        const n = top as Record<string, unknown>;
        const isRoot = n['@_Type'] === '0' && n['@_Name'] === 'ROOT';
        if (isRoot) {
          let sort = 0;
          for (const child of asArray(n.NODE)) {
            walkPlaylistNode(db, child as Record<string, unknown>, null, trackIdBySourceId, result, sort++);
          }
        } else {
          walkPlaylistNode(db, n, null, trackIdBySourceId, result);
        }
      }
    });
    tx();
  }

  db.prepare(
    `UPDATE ingest_runs SET finished_at = datetime('now'), status = 'ok', track_count = ? WHERE id = ?`
  ).run(result.tracks, runId);

  return result;
}

function walkPlaylistNode(
  db: BetterSqlite3.Database,
  node: Record<string, unknown>,
  parentId: number | null,
  trackIdBySourceId: Map<string, number>,
  result: XmlIngestResult,
  sort = 0
): void {
  const name = (node['@_Name'] as string) ?? 'Senza nome';
  const isFolder = node['@_Type'] === '0';
  const info = db
    .prepare(
      `INSERT INTO playlists (source, source_id, name, parent_id, is_folder, sort_order)
       VALUES ('xml', NULL, ?, ?, ?, ?)`
    )
    .run(name, parentId, isFolder ? 1 : 0, sort);
  const playlistId = Number(info.lastInsertRowid);
  result.playlists++;

  if (isFolder) {
    let childSort = 0;
    for (const child of asArray(node.NODE)) {
      walkPlaylistNode(
        db,
        child as Record<string, unknown>,
        playlistId,
        trackIdBySourceId,
        result,
        childSort++
      );
    }
  } else {
    const insertPt = db.prepare(
      `INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)`
    );
    let pos = 0;
    for (const t of asArray(node.TRACK)) {
      const key = (t as Record<string, string>)['@_Key'];
      const trackId = trackIdBySourceId.get(key);
      if (trackId !== undefined) insertPt.run(playlistId, trackId, pos++);
    }
  }
}

function rgbAttrs(mark: Record<string, string>): string | null {
  const r = mark['@_Red'];
  const g = mark['@_Green'];
  const b = mark['@_Blue'];
  if (r === undefined || g === undefined || b === undefined) return null;
  const hex = (v: string) => Number(v).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

/** Euristica per tag corrotti: replacement char, control chars o mojibake UTF-8 doppio. */
export function hasSuspectEncoding(s: string | undefined | null): boolean {
  if (!s) return false;
  // eslint-disable-next-line no-control-regex
  const controlOrReplacement = /[ --]|�/;
  // Mojibake tipico da UTF-8 letto come Latin-1: Ã seguito da un byte alto.
  const mojibake = /Ã[-¿]/;
  return controlOrReplacement.test(s) || mojibake.test(s);
}
