import { create } from 'xmlbuilder2';
import { writeFileSync } from 'fs';
import type BetterSqlite3 from 'better-sqlite3';
import type { TrackRow } from '@core/udm';
import { pathToLocation } from '../common';

/**
 * XML della scaletta del Set Builder: i brani esistono già nella collection
 * di Rekordbox, quindi l'utile è la PLAYLIST; i TRACK ripetono i metadati
 * dall'UDM (l'import XML aggiorna/aggancia, mai rimuove). Import manuale,
 * come sempre.
 */
export function writeSetXml(
  db: BetterSqlite3.Database,
  trackIds: number[],
  playlistName: string,
  outPath: string
): { written: number } {
  const stmt = db.prepare(`SELECT * FROM tracks WHERE id = ?`);
  const tracks = trackIds
    .map((id) => stmt.get(id) as TrackRow | undefined)
    .filter((t): t is TrackRow => !!t && !!t.path);

  const doc = create({ version: '1.0', encoding: 'UTF-8' });
  const root = doc.ele('DJ_PLAYLISTS', { Version: '1.0.0' });
  root.ele('PRODUCT', { Name: 'CrateForge', Version: '0.1.0', Company: 'TX-Breaker' });
  const collection = root.ele('COLLECTION', { Entries: String(tracks.length) });
  for (const t of tracks) {
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
      Location: pathToLocation(t.path as string)
    });
  }
  const playlists = root.ele('PLAYLISTS');
  const rootNode = playlists.ele('NODE', { Type: '0', Name: 'ROOT', Count: '1' });
  const pl = rootNode.ele('NODE', {
    Type: '1',
    Name: playlistName,
    KeyType: '0',
    Entries: String(tracks.length)
  });
  for (const t of tracks) pl.ele('TRACK', { Key: t.source_id ?? String(t.id) });

  writeFileSync(outPath, doc.end({ prettyPrint: true }), 'utf-8');
  return { written: tracks.length };
}
