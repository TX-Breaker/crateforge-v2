import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { XMLParser } from 'fast-xml-parser';
import Database from 'better-sqlite3';
import { migrate } from '@core/schema';
import { findBrokenTracks, matchByFilename } from '@services/relocator/relocator';
import { writeRelocationXml } from '@adapters/rekordbox/relocationXml';
import type { TrackRow } from '@core/udm';

let tmp: string;
let db: InstanceType<typeof Database>;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'cf-reloc-'));
  db = new Database(':memory:');
  migrate(db);
});
afterEach(() => {
  db.close();
  rmSync(tmp, { recursive: true, force: true });
});

function insertTrack(path: string | null, title: string): number {
  const info = db
    .prepare(`INSERT INTO tracks (source, source_id, title, path) VALUES ('xml', ?, ?, ?)`)
    .run(title, title, path);
  return Number(info.lastInsertRowid);
}

describe('findBrokenTracks', () => {
  it('trova solo i brani il cui path non esiste su disco', () => {
    const existing = join(tmp, 'presente.mp3');
    writeFileSync(existing, 'x');
    insertTrack(existing, 'Presente');
    insertTrack(join(tmp, 'sparito.mp3'), 'Sparito');
    insertTrack(null, 'SenzaPath'); // path NULL: ignorato

    const broken = findBrokenTracks(db);
    expect(broken).toHaveLength(1);
    expect(broken[0].track.title).toBe('Sparito');
    expect(broken[0].oldPath).toBe(join(tmp, 'sparito.mp3'));
  });
});

describe('matchByFilename', () => {
  it('ricollega per nome file e segnala gli ambigui', async () => {
    const newRoot = join(tmp, 'nuova');
    mkdirSync(join(newRoot, 'sub'), { recursive: true });
    // Due file con lo stesso nome in cartelle diverse → ambiguo
    writeFileSync(join(newRoot, 'brano.mp3'), 'a');
    writeFileSync(join(newRoot, 'sub', 'brano.mp3'), 'b');
    writeFileSync(join(newRoot, 'unico.mp3'), 'c');

    const broken = [
      { track: { title: 'B' } as TrackRow, oldPath: 'C:\\vecchia\\brano.mp3' },
      { track: { title: 'U' } as TrackRow, oldPath: 'C:\\vecchia\\unico.mp3' },
      { track: { title: 'M' } as TrackRow, oldPath: 'C:\\vecchia\\manca.mp3' }
    ];
    const matches = await matchByFilename(broken, newRoot);

    const b = matches.find((m) => m.track.title === 'B')!;
    expect(b.newPath).not.toBeNull();
    expect(b.ambiguous).toHaveLength(1); // il secondo brano.mp3
    const u = matches.find((m) => m.track.title === 'U')!;
    expect(u.newPath).toBe(join(newRoot, 'unico.mp3'));
    expect(u.ambiguous).toHaveLength(0);
    const m = matches.find((m) => m.track.title === 'M')!;
    expect(m.newPath).toBeNull(); // nessun match
  });

  it('estrae il nome file da path Windows-style anche su POSIX (basename cross-piattaforma)', async () => {
    // Regressione: path.basename di POSIX non splitta i backslash, quindi
    // 'C:\\x\\brano.mp3' su macOS/Linux non matcherebbe. Il relocator è proprio
    // il caso "libreria spostata tra macchine": deve reggere path di ogni stile.
    const newRoot = join(tmp, 'nuova2');
    mkdirSync(newRoot, { recursive: true });
    writeFileSync(join(newRoot, 'canzone.mp3'), 'x');

    const broken = [{ track: { title: 'W' } as TrackRow, oldPath: 'C:\\Music\\Old\\canzone.mp3' }];
    const [match] = await matchByFilename(broken, newRoot);
    expect(match.newPath).toBe(join(newRoot, 'canzone.mp3'));
  });
});

describe('writeRelocationXml', () => {
  it('scrive SOLO i brani ricollegati, con la nuova Location', () => {
    const out = join(tmp, 'reloc.xml');
    const matches = [
      {
        track: { id: 1, source_id: '10', title: 'Ok', artist: 'A', album: null, genre: null, duration_s: 200, year: 2020, bpm: 128, musical_key: 'Am' } as TrackRow,
        oldPath: 'C:\\old\\ok.mp3',
        newPath: 'C:\\new\\ok.mp3',
        ambiguous: []
      },
      {
        track: { id: 2, source_id: '11', title: 'NoMatch' } as TrackRow,
        oldPath: 'C:\\old\\no.mp3',
        newPath: null,
        ambiguous: []
      }
    ];
    const r = writeRelocationXml(matches, out);
    expect(r.written).toBe(1);
    expect(r.unmatched).toBe(1);

    const doc = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' }).parse(
      readFileSync(out, 'utf-8')
    );
    const tracks = doc.DJ_PLAYLISTS.COLLECTION.TRACK;
    // Un solo TRACK (il non-matchato è escluso)
    const arr = Array.isArray(tracks) ? tracks : [tracks];
    expect(arr).toHaveLength(1);
    expect(arr[0]['@_Location']).toContain('new');
    // Il drive letter non è percent-encodato
    expect(arr[0]['@_Location']).toContain('C:/');
  });
});
