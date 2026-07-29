import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { deflateSync } from 'zlib';
import Database from 'better-sqlite3';
import { migrate } from '@core/schema';
import { importForeignLibrary } from '@core/foreignImport';
import { readEngineLibrary } from '@adapters/engine/engineReader';

/** Costruisce un blob quickCues Engine: [uint32 BE len][zlib(payload)], payload =
 *  int64 BE count + slot(uint8 len|label|double BE pos-sample|ARGB). */
function quickCuesBlob(cues: { label: string; posSamples: number; rgb: [number, number, number] }[]): Buffer {
  const header = Buffer.alloc(8);
  header.writeBigInt64BE(BigInt(cues.length));
  const slots = cues.map((c) => {
    const lab = Buffer.from(c.label, 'utf8');
    const b = Buffer.alloc(1 + lab.length + 8 + 4);
    let o = 0;
    b.writeUInt8(lab.length, o);
    o += 1;
    lab.copy(b, o);
    o += lab.length;
    b.writeDoubleBE(c.posSamples, o);
    o += 8;
    b.writeUInt8(0xff, o); // alpha/enabled
    b.writeUInt8(c.rgb[0], o + 1);
    b.writeUInt8(c.rgb[1], o + 2);
    b.writeUInt8(c.rgb[2], o + 3);
    return b;
  });
  const payload = Buffer.concat([header, ...slots]);
  const z = deflateSync(payload);
  const framed = Buffer.alloc(4 + z.length);
  framed.writeUInt32BE(payload.length, 0);
  z.copy(framed, 4);
  return framed;
}

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cf-engine-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Crea un finto Engine Library m.db con lo schema minimo comune. */
function makeEngineDb(): string {
  const p = join(dir, 'm.db');
  const db = new Database(p);
  db.exec(`
    CREATE TABLE Track (
      id INTEGER PRIMARY KEY, title TEXT, artist TEXT, album TEXT, genre TEXT,
      year INTEGER, bpmAnalyzed REAL, keyAnalyzed INTEGER, length INTEGER,
      path TEXT, fileBytes INTEGER
    );
    CREATE TABLE Playlist (id INTEGER PRIMARY KEY, title TEXT);
    CREATE TABLE PlaylistEntity (id INTEGER PRIMARY KEY, listId INTEGER, trackId INTEGER);
  `);
  const ins = db.prepare(
    `INSERT INTO Track (id,title,artist,album,genre,year,bpmAnalyzed,keyAnalyzed,length,path,fileBytes)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  );
  ins.run(1, 'One More Time', 'Daft Punk', 'Discovery', 'House', 2000, 123.0, 21, 320, 'C:\\Music\\omt.mp3', 8000000);
  ins.run(2, 'Aerodynamic', 'Daft Punk', 'Discovery', 'House', 2001, 123.0, 8, 210, 'C:\\Music\\aero.mp3', 6000000);
  db.prepare(`INSERT INTO Playlist (id,title) VALUES (1,'Discovery')`).run();
  db.prepare(`INSERT INTO PlaylistEntity (id,listId,trackId) VALUES (1,1,1),(2,1,2)`).run();
  db.close();
  return p;
}

describe('readEngineLibrary', () => {
  it('legge brani, bpm, key (0-23), playlist da SQLite in chiaro', () => {
    const p = makeEngineDb();
    const lib = readEngineLibrary(p);
    expect(lib.source).toBe('engine');
    expect(lib.tracks).toHaveLength(2);
    const omt = lib.tracks.find((t) => t.sourceId === '1')!;
    expect(omt.title).toBe('One More Time');
    expect(omt.bpm).toBe(123);
    expect(omt.musicalKey).toBe('F#m'); // keyAnalyzed 21 → F#m (ordinamento Camelot, 11A)
    expect(omt.path).toBe('C:\\Music\\omt.mp3');
    expect(lib.tracks.find((t) => t.sourceId === '2')!.musicalKey).toBe('D#'); // 8 → D# (5B)
    expect(lib.playlists).toHaveLength(1);
    expect(lib.playlists[0].trackSourceIds).toEqual(['1', '2']);
    expect(lib.warnings.some((w) => w.toLowerCase().includes('cue'))).toBe(true);
  });

  it('import nell UDM: 2 brani + playlist collegata', () => {
    const p = makeEngineDb();
    const db = new Database(':memory:');
    migrate(db);
    const r = importForeignLibrary(db, readEngineLibrary(p));
    expect(r.tracks).toBe(2);
    expect(r.playlists).toBe(1);
    const linked = db.prepare(`SELECT COUNT(*) c FROM playlist_tracks`).get() as { c: number };
    expect(linked.c).toBe(2);
    const cam = db.prepare(`SELECT camelot FROM tracks WHERE source_id='1'`).get() as { camelot: string };
    expect(cam.camelot).toBe('11A'); // key 21 → F#m → 11A
  });

  it('decodifica gli hot cue dai blob PerformanceData (sample→ms, ARGB→hex)', () => {
    const p = join(dir, 'm.db');
    const db = new Database(p);
    db.exec(`
      CREATE TABLE Track (id INTEGER PRIMARY KEY, title TEXT, bpmAnalyzed REAL, keyAnalyzed INTEGER, path TEXT, rating INTEGER);
      CREATE TABLE PerformanceData (trackId INTEGER PRIMARY KEY, quickCues BLOB, loops BLOB, trackData BLOB);
    `);
    db.prepare(`INSERT INTO Track (id,title,bpmAnalyzed,keyAnalyzed,path,rating) VALUES (1,'T',120,0,'/m/a.mp3',80)`).run();
    // Due hot cue: 44100 sample = 1000 ms (SR fallback 44100); 88200 = 2000 ms.
    const blob = quickCuesBlob([
      { label: 'Cue 1', posSamples: 44100, rgb: [244, 211, 56] },
      { label: 'Cue 2', posSamples: 88200, rgb: [0, 255, 0] }
    ]);
    db.prepare(`INSERT INTO PerformanceData (trackId,quickCues,loops,trackData) VALUES (1,?,NULL,NULL)`).run(blob);
    db.close();

    const lib = readEngineLibrary(p);
    const t = lib.tracks.find((x) => x.sourceId === '1')!;
    expect(t.rating).toBe(80);
    expect(t.cues).toHaveLength(2);
    expect(t.cues[0]).toMatchObject({ type: 'hot', index: 0, positionMs: 1000, color: '#F4D338', label: 'Cue 1' });
    expect(t.cues[1]).toMatchObject({ type: 'hot', index: 1, positionMs: 2000, color: '#00FF00', label: 'Cue 2' });
  });

  it('rifiuta un db senza tabella Track', () => {
    const p = join(dir, 'bad.db');
    const db = new Database(p);
    db.exec(`CREATE TABLE Nope (id INTEGER)`);
    db.close();
    expect(() => readEngineLibrary(p)).toThrow(/Track/);
  });
});
