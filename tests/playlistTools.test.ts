import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import {
  buildCsv,
  buildM3u,
  dedupeConsecutive,
  listPlaylistsFull,
  playlistDetail
} from '../src/services/playlist/playlistTools';

/**
 * Strumenti della schermata Playlist, su archivio in memoria: elenco con
 * cartelle, dettaglio con statistica, pulizia dei doppioni consecutivi,
 * export M3U8 e CSV. Nessun tocco al disco: l'esistenza dei file è iniettata.
 */

function archivio(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE playlists (
      id INTEGER PRIMARY KEY,
      source TEXT NOT NULL,
      source_id TEXT,
      name TEXT NOT NULL,
      parent_id INTEGER REFERENCES playlists(id) ON DELETE CASCADE,
      is_folder INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE playlist_tracks (
      playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
      track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      PRIMARY KEY (playlist_id, position)
    );
    CREATE TABLE tracks (
      id INTEGER PRIMARY KEY,
      title TEXT, artist TEXT, album TEXT, genre TEXT,
      bpm REAL, camelot TEXT, duration_s REAL, path TEXT
    );
  `);
  db.prepare(
    `INSERT INTO playlists (id, source, name, is_folder) VALUES (1, 'masterdb', 'Serata', 0),
     (2, 'masterdb', 'Cartelle', 1), (3, 'xml', 'Retro', 0)`
  ).run();
  db.prepare(`UPDATE playlists SET parent_id = 2 WHERE id = 1`).run();
  const t = db.prepare(
    `INSERT INTO tracks (id, title, artist, album, genre, bpm, camelot, duration_s, path)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  t.run(10, 'Alpha', 'Uno', 'Disco', 'House', 124, '8A', 300, 'C:/m/alpha.mp3');
  t.run(11, 'Beta', 'Due', null, null, 128, '8A', 240, 'C:/m/beta.mp3');
  t.run(12, 'Gamma', 'Tre', null, null, null, null, null, null);
  const pt = db.prepare(
    `INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)`
  );
  for (const [pos, id] of [[0, 10], [1, 11], [2, 11], [3, 12]] as const) pt.run(1, id, pos);
  return db;
}

describe('listPlaylistsFull', () => {
  it('porta cartelle, genitore e conteggio', () => {
    const db = archivio();
    const rows = listPlaylistsFull(db);
    const serata = rows.find((r) => r.name === 'Serata');
    expect(serata).toMatchObject({ trackCount: 4, isFolder: false, parentName: 'Cartelle', source: 'masterdb' });
    const cartelle = rows.find((r) => r.name === 'Cartelle');
    expect(cartelle).toMatchObject({ isFolder: true, trackCount: 0 });
    db.close();
  });
});

describe('playlistDetail', () => {
  it('statistiche, ordine e file mancanti', () => {
    const db = archivio();
    const d = playlistDetail(db, 1, () => false)!;
    expect(d.tracks.map((t) => t.position)).toEqual([0, 1, 2, 3]);
    expect(d.stats.durationS).toBe(780); // Beta (240s) conta due volte: e' in lista due volte
    expect(d.stats.bpmMin).toBe(124);
    expect(d.stats.bpmMax).toBe(128);
    expect(d.stats.keys).toEqual([{ key: '8A', n: 3 }]); // Alpha + Beta due volte
    expect(d.tracks.every((t) => t.missing)).toBe(true);
    const d2 = playlistDetail(db, 1, (p) => p === 'C:/m/alpha.mp3')!;
    expect(d2.tracks.filter((t) => !t.missing)).toHaveLength(1);
    expect(playlistDetail(db, 99)).toBeNull();
    db.close();
  });
});

describe('dedupeConsecutive', () => {
  it('toglie solo i doppioni di fila e riserra le posizioni', () => {
    const db = archivio();
    const r = dedupeConsecutive(db, 1);
    expect(r).toBe(1);
    const dopo = playlistDetail(db, 1)!;
    expect(dopo.tracks.map((t) => t.id)).toEqual([10, 11, 12]);
    expect(dopo.tracks.map((t) => t.position)).toEqual([0, 1, 2]);
    expect(dedupeConsecutive(db, 1)).toBe(0);
    db.close();
  });
});

describe('buildM3u / buildCsv', () => {
  it('m3u8 con EXTINF e soli percorsi presenti; csv con BOM e separatore ;', () => {
    const db = archivio();
    const d = playlistDetail(db, 1, () => true)!;
    const m3u = buildM3u(d.tracks, 'Serata');
    expect(m3u.startsWith('#EXTM3U')).toBe(true);
    expect(m3u).toContain('#PLAYLIST:Serata');
    expect((m3u.match(/#EXTINF:/g) ?? []).length).toBe(3); // Gamma non ha path
    expect(m3u).toContain('C:/m/alpha.mp3');

    const csv = buildCsv(d.tracks);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.split('\r\n')[1]).toContain('Alpha');
    db.close();
  });
});
