import { create } from 'xmlbuilder2';
import { writeFileSync } from 'fs';
import type BetterSqlite3 from 'better-sqlite3';
import { ExportSelection, getCuesForTrack, iterateTracks } from '../common';

/**
 * Export VirtualDJ database XML (§6 Fase 1.4).
 * Genera un database.xml NUOVO (da importare/unire manualmente in VirtualDJ):
 * non tocca mai il database.xml esistente dell'utente.
 */
export function writeVirtualDjXml(
  db: BetterSqlite3.Database,
  outPath: string,
  sel: ExportSelection = {},
  onProgress?: (done: number) => void
): { tracks: number } {
  const doc = create({ version: '1.0', encoding: 'UTF-8' });
  const root = doc.ele('VirtualDJ_Database', { Version: '2024' });

  let count = 0;
  for (const t of iterateTracks(db, sel)) {
    if (!t.path) continue;
    const song = root.ele('Song', {
      FilePath: t.path,
      FileSize: t.filesize !== null ? String(t.filesize) : ''
    });
    song.ele('Tags', {
      Author: t.artist ?? '',
      Title: t.title ?? '',
      Album: t.album ?? '',
      Genre: t.genre ?? '',
      Year: t.year !== null ? String(t.year) : '',
      Remix: t.version_label ?? ''
    });
    // Infos@SongLength: il nostro reader legge la durata da qui, senza si
    // perde nel round-trip finché VDJ non ri-analizza.
    if (t.duration_s !== null) song.ele('Infos', { SongLength: t.duration_s.toFixed(3) });
    const scan: Record<string, string> = {};
    const scanBpm = t.beatgrid_bpm != null && t.beatgrid_bpm > 0 ? t.beatgrid_bpm : t.bpm;
    if (scanBpm !== null && scanBpm > 0) scan.Bpm = (60 / scanBpm).toFixed(6); // VDJ usa secondi-per-beat
    // Phase = downbeat in secondi: preserva la fase della beatgrid se nota.
    if (t.beatgrid_anchor_ms != null) scan.Phase = (t.beatgrid_anchor_ms / 1000).toFixed(6);
    if (t.musical_key) scan.Key = t.musical_key;
    if (Object.keys(scan).length) song.ele('Scan', scan);

    for (const c of getCuesForTrack(db, t.id)) {
      if (c.cue_type === 'hot' && c.cue_index !== null) {
        song.ele('Poi', {
          Name: c.label ?? `Cue ${c.cue_index + 1}`,
          Pos: (c.position_ms / 1000).toFixed(4),
          Num: String(c.cue_index + 1),
          Type: 'cue'
        });
      } else if (c.cue_type === 'loop' && c.length_ms !== null) {
        song.ele('Poi', {
          Name: c.label ?? 'Loop',
          Pos: (c.position_ms / 1000).toFixed(4),
          Size: (c.length_ms / 1000).toFixed(4),
          Type: 'loop'
        });
      }
    }
    count++;
    if (count % 500 === 0) onProgress?.(count);
  }

  writeFileSync(outPath, doc.end({ prettyPrint: true }), 'utf-8');
  return { tracks: count };
}
