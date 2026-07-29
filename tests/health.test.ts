import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { migrate } from '@core/schema';
import { computeHealth } from '@core/health';

function memDb() {
  const db = new Database(':memory:');
  migrate(db);
  return db;
}

describe('computeHealth', () => {
  it('libreria vuota: score 0, nessun crash', () => {
    const h = computeHealth(memDb());
    expect(h.total).toBe(0);
    expect(h.score).toBe(0);
  });

  it('libreria perfetta: score 100', () => {
    const db = memDb();
    const ins = db.prepare(
      `INSERT INTO tracks (source, source_id, title, artist, bpm, camelot, genre, year, acoustic_id)
       VALUES ('xml', ?, 'T', 'A', 128, '8A', 'House', 2020, ?)`
    );
    ins.run('1', 'aid-1');
    ins.run('2', 'aid-2');
    const h = computeHealth(db);
    expect(h.total).toBe(2);
    expect(h.score).toBe(100);
    expect(h.duplicateGroups).toBe(0);
  });

  it('conta buchi, duplicati e senza-cue; score cala', () => {
    const db = memDb();
    const ins = db.prepare(
      `INSERT INTO tracks (source, source_id, title, bpm, camelot, genre, year, acoustic_id, needs_review)
       VALUES ('xml', ?, 'T', ?, ?, ?, ?, ?, ?)`
    );
    ins.run('1', 128, '8A', 'House', 2020, 'same', 0);
    ins.run('2', 128, '8A', 'House', 2020, 'same', 0); // duplicato acustico
    ins.run('3', null, null, null, null, null, 1); // tutto mancante + review
    const trackWithCue = (db.prepare(`SELECT id FROM tracks LIMIT 1`).get() as { id: number }).id;
    db.prepare(
      `INSERT INTO cues (track_id, cue_type, position_ms) VALUES (?, 'hot', 1000)`
    ).run(trackWithCue);

    const h = computeHealth(db);
    expect(h.total).toBe(3);
    expect(h.missingBpm).toBe(1);
    expect(h.missingKey).toBe(1);
    expect(h.needsReview).toBe(1);
    expect(h.duplicateGroups).toBe(1);
    expect(h.duplicateTracks).toBe(2);
    expect(h.withoutHotCues).toBe(2);
    expect(h.fingerprinted).toBe(2);
    expect(h.score).toBeLessThan(100);
    expect(h.score).toBeGreaterThan(0);
  });
});
