import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { migrate } from '@core/schema';
import { buildSet } from '@services/setbuilder/setBuilder';
import { isCompatible, parseCamelot } from '@core/harmony';

function seeded() {
  const db = new Database(':memory:');
  migrate(db);
  const ins = db.prepare(
    `INSERT INTO tracks (source, source_id, title, artist, bpm, camelot, genre, duration_s, path)
     VALUES ('xml', ?, ?, ?, ?, ?, 'House', 300, 'C:\\m\\' || ? || '.mp3')`
  );
  // catena costruibile: 8A→(8A/7A/9A/8B) con bpm crescenti
  ins.run('1', 'Start', 'DJ A', 124, '8A', '1');
  ins.run('2', 'Two', 'DJ B', 126, '9A', '2');
  ins.run('3', 'Three', 'DJ C', 128, '9B', '3');
  ins.run('4', 'Four', 'DJ D', 130, '10B', '4');
  ins.run('5', 'FarAway', 'DJ E', 175, '3B', '5'); // mai raggiungibile (bpm)
  return db;
}

describe('buildSet', () => {
  it('catena: ogni transizione compatibile Camelot, nessun brano ripetuto', () => {
    const db = seeded();
    const startId = (db.prepare(`SELECT id FROM tracks WHERE title='Start'`).get() as { id: number }).id;
    const r = buildSet(db, startId, 4, 'up');
    expect(r.tracks.length).toBeGreaterThanOrEqual(3);
    const ids = new Set(r.tracks.map((t) => t.id));
    expect(ids.size).toBe(r.tracks.length); // no ripetizioni
    for (let i = 0; i < r.tracks.length - 1; i++) {
      const a = parseCamelot(r.tracks[i].camelot)!;
      const b = parseCamelot(r.tracks[i + 1].camelot)!;
      expect(isCompatible(a, b)).toBe(true);
    }
    // il brano irraggiungibile per BPM non entra
    expect(r.tracks.some((t) => t.title === 'FarAway')).toBe(false);
  });

  it('si ferma con exhausted=true se mancano candidati', () => {
    const db = seeded();
    const startId = (db.prepare(`SELECT id FROM tracks WHERE title='Start'`).get() as { id: number }).id;
    const r = buildSet(db, startId, 30, 'up');
    expect(r.exhausted).toBe(true);
    expect(r.tracks.length).toBeLessThan(30);
  });

  it('rifiuta un brano di partenza senza key/BPM con errore chiaro', () => {
    const db = seeded();
    db.prepare(
      `INSERT INTO tracks (source, source_id, title) VALUES ('xml', 'x', 'NoData')`
    ).run();
    const badId = (db.prepare(`SELECT id FROM tracks WHERE title='NoData'`).get() as { id: number }).id;
    expect(() => buildSet(db, badId, 5, 'flat')).toThrow(/key e BPM/);
  });
});
