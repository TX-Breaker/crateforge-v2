import { create } from 'xmlbuilder2';
import { writeFileSync } from 'fs';
import type { RelocationMatch } from '@services/relocator/relocator';
import { pathToLocation } from '../common';

/**
 * XML di aggiornamento per il Relocator (§6 Fase 1.5): stessi TrackID,
 * Location nuova. Da re-importare manualmente in Rekordbox.
 * Mai scrivere il nuovo path nel master.db.
 */
export function writeRelocationXml(
  matches: RelocationMatch[],
  outPath: string
): { written: number; unmatched: number } {
  const matched = matches.filter((m) => m.newPath !== null);
  const doc = create({ version: '1.0', encoding: 'UTF-8' });
  const root = doc.ele('DJ_PLAYLISTS', { Version: '1.0.0' });
  root.ele('PRODUCT', { Name: 'CrateForge', Version: '0.1.0', Company: 'TX-Breaker' });
  const collection = root.ele('COLLECTION', { Entries: String(matched.length) });

  for (const m of matched) {
    const t = m.track;
    collection.ele('TRACK', {
      TrackID: t.source_id ?? String(t.id),
      Name: t.title ?? '',
      Artist: t.artist ?? '',
      Album: t.album ?? '',
      Genre: t.genre ?? '',
      TotalTime: t.duration_s !== null ? String(Math.round(t.duration_s)) : '0',
      Year: t.year !== null ? String(t.year) : '',
      AverageBpm: t.bpm !== null ? t.bpm.toFixed(2) : '',
      Tonality: t.musical_key ?? '',
      Location: pathToLocation(m.newPath as string)
    });
  }
  root.ele('PLAYLISTS').ele('NODE', { Type: '0', Name: 'ROOT', Count: '0' });

  writeFileSync(outPath, doc.end({ prettyPrint: true }), 'utf-8');
  return { written: matched.length, unmatched: matches.length - matched.length };
}
