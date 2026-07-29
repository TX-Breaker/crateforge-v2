import { describe, expect, it } from 'vitest';
import { join } from 'path';
import Database from 'better-sqlite3';
import { migrate } from '@core/schema';
import { ingestCollectionXml, locationToPath } from '@core/xmlCollection';

const FIXTURE = join(__dirname, 'fixtures', 'collection.xml');

function ingest() {
  const db = new Database(':memory:');
  migrate(db);
  const result = ingestCollectionXml(db, FIXTURE);
  return { db, result };
}

describe('locationToPath', () => {
  it('converte URL Windows', () => {
    expect(locationToPath('file://localhost/C:/Music/a%20b.mp3')).toBe('C:\\Music\\a b.mp3');
  });
  it('converte URL POSIX', () => {
    expect(locationToPath('file://localhost/Users/x/m%C3%BAsica.mp3')).toBe('/Users/x/música.mp3');
  });
  it('null su input mancante', () => {
    expect(locationToPath(undefined)).toBeNull();
  });
});

describe('ingestCollectionXml (modalità solo-XML, pure-Node)', () => {
  it('importa tracce, playlist e cue', () => {
    const { result } = ingest();
    expect(result.tracks).toBe(4);
    // ROOT non è una playlist: Cartella Set (folder) + Warm Up
    expect(result.playlists).toBeGreaterThanOrEqual(2);
    expect(result.cues).toBe(12); // 10 hot + 1 memory + 1 loop
  });

  it('normalizza camelot e versione', () => {
    const { db } = ingest();
    const levels = db
      .prepare(`SELECT * FROM tracks WHERE source_id = '1001'`)
      .get() as Record<string, unknown>;
    expect(levels.camelot).toBe('12A'); // C#m
    expect(levels.version_label).toBe('Extended Mix');
    expect(levels.path).toBe('C:\\Music\\Avicii - Levels (Extended Mix).mp3');
  });

  it('marca tag mancanti e encoding sospetto', () => {
    const { db } = ingest();
    const noArtist = db
      .prepare(`SELECT * FROM tracks WHERE source_id = '1003'`)
      .get() as Record<string, unknown>;
    expect(noArtist.has_tag_issues).toBe(1);
    expect(noArtist.version_label).toBe('Club Mix'); // estratta dal titolo

    const mojibake = db
      .prepare(`SELECT * FROM tracks WHERE source_id = '1004'`)
      .get() as Record<string, unknown>;
    expect(mojibake.needs_review).toBe(1);
    expect(mojibake.review_reason).toBeTruthy();
  });

  it('classifica i tipi di cue', () => {
    const { db } = ingest();
    const byType = db
      .prepare(
        `SELECT cue_type, COUNT(*) c FROM cues GROUP BY cue_type`
      )
      .all() as { cue_type: string; c: number }[];
    const map = Object.fromEntries(byType.map((r) => [r.cue_type, r.c]));
    expect(map.hot).toBe(10);
    expect(map.memory).toBe(1);
    expect(map.loop).toBe(1);
  });

  it('è idempotente (re-import senza duplicati)', () => {
    const db = new Database(':memory:');
    migrate(db);
    ingestCollectionXml(db, FIXTURE);
    const second = ingestCollectionXml(db, FIXTURE);
    expect(second.tracks).toBe(4);
    const count = (db.prepare('SELECT COUNT(*) c FROM tracks').get() as { c: number }).c;
    expect(count).toBe(4);
  });
});
