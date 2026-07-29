import { create } from 'xmlbuilder2';
import { writeFileSync } from 'fs';
import type { InboxItem } from '@services/watcher/syncDaemon';
import { pathToLocation } from '../common';

/**
 * XML di import per i "Nuovi Acquisti" (§6 Fase 3.1). L'utente lo importa
 * A MANO in Rekordbox (Import to Collection): nessuna iniezione nel master.db.
 * Include una playlist "CrateForge – Nuovi Acquisti" per ritrovarli subito.
 */
export function writeInboxXml(
  items: InboxItem[],
  outPath: string
): { written: number } {
  const doc = create({ version: '1.0', encoding: 'UTF-8' });
  const root = doc.ele('DJ_PLAYLISTS', { Version: '1.0.0' });
  root.ele('PRODUCT', { Name: 'CrateForge', Version: '0.1.0', Company: 'TX-Breaker' });
  const collection = root.ele('COLLECTION', { Entries: String(items.length) });

  items.forEach((it, i) => {
    collection.ele('TRACK', {
      TrackID: String(1_000_000 + i), // ID arbitrari: Rekordbox li riassegna all'import
      Name: it.title ?? '',
      Artist: it.artist ?? '',
      Album: it.album ?? '',
      Genre: it.genre ?? '',
      TotalTime: it.duration_s !== null ? String(Math.round(it.duration_s)) : '0',
      Year: it.year !== null ? String(it.year) : '',
      AverageBpm: it.bpm !== null ? it.bpm.toFixed(2) : '',
      Tonality: it.musical_key ?? '',
      Location: pathToLocation(it.path)
    });
  });

  const playlists = root.ele('PLAYLISTS');
  const rootNode = playlists.ele('NODE', { Type: '0', Name: 'ROOT', Count: '1' });
  const pl = rootNode.ele('NODE', {
    Type: '1',
    Name: 'CrateForge – Nuovi Acquisti',
    KeyType: '0',
    Entries: String(items.length)
  });
  items.forEach((_it, i) => pl.ele('TRACK', { Key: String(1_000_000 + i) }));

  writeFileSync(outPath, doc.end({ prettyPrint: true }), 'utf-8');
  return { written: items.length };
}
