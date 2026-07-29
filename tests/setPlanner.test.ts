import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { migrate } from '@core/schema';
import { analyzePlaylist, listPlaylists, suggestBridges } from '@services/planner/setPlanner';

function seededDb() {
  const db = new Database(':memory:');
  migrate(db);
  const ins = db.prepare(
    `INSERT INTO tracks (source, source_id, title, artist, bpm, camelot)
     VALUES ('xml', ?, ?, 'DJ Test', ?, ?)`
  );
  ins.run('1', 'A', 128, '8A');
  ins.run('2', 'B', 140, '3B'); // clash con A + salto bpm
  ins.run('3', 'Ponte', 133, '8B'); // compatibile con 8A; NON con 3B
  ins.run('4', 'PonteVero', 134, '3A'); // compatibile con 3B, non con 8A
  db.prepare(
    `INSERT INTO playlists (source, source_id, name, is_folder) VALUES ('xml', 'p1', 'Set Sabato', 0)`
  ).run();
  const pid = (db.prepare(`SELECT id FROM playlists`).get() as { id: number }).id;
  const pt = db.prepare(
    `INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)`
  );
  const ids = db.prepare(`SELECT id FROM tracks ORDER BY id`).all() as { id: number }[];
  pt.run(pid, ids[0].id, 0);
  pt.run(pid, ids[1].id, 1);
  return { db, pid };
}

describe('listPlaylists', () => {
  it('esclude cartelle e playlist con <2 brani', () => {
    const { db } = seededDb();
    db.prepare(
      `INSERT INTO playlists (source, source_id, name, is_folder) VALUES ('xml', 'f1', 'Cartella', 1)`
    ).run();
    const ls = listPlaylists(db);
    expect(ls).toHaveLength(1);
    expect(ls[0].name).toBe('Set Sabato');
    expect(ls[0].trackCount).toBe(2);
  });
});

describe('analyzePlaylist', () => {
  it('rileva clash armonico + salto bpm sulla transizione', () => {
    const { db, pid } = seededDb();
    const r = analyzePlaylist(db, pid);
    expect(r.tracks).toBe(2);
    expect(r.transitions).toHaveLength(1);
    expect(r.problems).toBe(1);
    const t = r.transitions[0];
    expect(t.flags).toContain('key-clash');
    expect(t.flags).toContain('bpm-jump');
  });
});

describe('suggestBridges', () => {
  it('propone solo tracce compatibili con ENTRAMBI i lati', () => {
    const { db } = seededDb();
    // 8A→3B: nessuna key è compatibile con entrambi (insiemi disgiunti) → 0 ponti
    const from = { id: 1, title: 'A', artist: 'x', bpm: 128, camelot: '8A', position: 0 };
    const to = { id: 2, title: 'B', artist: 'x', bpm: 140, camelot: '3B', position: 1 };
    expect(suggestBridges(db, from, to)).toHaveLength(0);

    // 8A→9B: 9A è compatibile con entrambi → un ponte se esiste in libreria
    db.prepare(
      `INSERT INTO tracks (source, source_id, title, artist, bpm, camelot)
       VALUES ('xml', '9', 'Bridge9A', 'DJ Test', 129, '9A')`
    ).run();
    const to2 = { id: 2, title: 'B', artist: 'x', bpm: 130, camelot: '9B', position: 1 };
    const bridges = suggestBridges(db, from, to2);
    expect(bridges.map((b) => b.title)).toContain('Bridge9A');
  });
});
