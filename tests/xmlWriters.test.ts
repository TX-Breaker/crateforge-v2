import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { XMLParser } from 'fast-xml-parser';
import Database from 'better-sqlite3';
import { migrate } from '@core/schema';
import { ingestCollectionXml } from '@core/xmlCollection';
import { writeRekordboxXml } from '@adapters/rekordbox/xmlWriter';
import { writeTraktorNml } from '@adapters/traktor/nmlWriter';
import { writeVirtualDjXml } from '@adapters/virtualdj/vdjWriter';

const FIXTURE = join(__dirname, 'fixtures', 'collection.xml');

let tmp: string;
let db: InstanceType<typeof Database>;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'crateforge-test-'));
  db = new Database(':memory:');
  migrate(db);
  ingestCollectionXml(db, FIXTURE);
});
afterEach(() => {
  db.close();
  rmSync(tmp, { recursive: true, force: true });
});

function parse(path: string) {
  return new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' }).parse(
    readFileSync(path, 'utf-8')
  );
}

describe('writeRekordboxXml', () => {
  it('produce XML valido con struttura attesa', () => {
    const out = join(tmp, 'rb.xml');
    const r = writeRekordboxXml(db, out);
    expect(r.tracks).toBe(4);
    const doc = parse(out);
    expect(doc.DJ_PLAYLISTS['@_Version']).toBe('1.0.0');
    expect(doc.DJ_PLAYLISTS.COLLECTION['@_Entries']).toBe('4');
    const tracks = doc.DJ_PLAYLISTS.COLLECTION.TRACK;
    expect(tracks).toHaveLength(4);
  });

  it('rispetta gli 8 pad di Rekordbox degradando il resto a memory', () => {
    const out = join(tmp, 'rb.xml');
    const r = writeRekordboxXml(db, out);
    const doc = parse(out);
    const tracks = doc.DJ_PLAYLISTS.COLLECTION.TRACK as Record<string, unknown>[];
    const levels = tracks.find((t) => (t['@_Name'] as string).startsWith('Levels'))!;
    const marks = levels.POSITION_MARK as Record<string, string>[];
    const hot = marks.filter((m) => m['@_Type'] === '0' && Number(m['@_Num']) >= 0);
    const memory = marks.filter((m) => m['@_Type'] === '0' && m['@_Num'] === '-1');
    const loops = marks.filter((m) => m['@_Type'] === '4');

    // Il limite dei pad resta (Rekordbox ne ha 8)…
    expect(hot).toHaveLength(8);
    // …ma i 2 hot cue in eccesso NON spariscono più: diventano memory cue,
    // così la posizione sopravvive alla conversione (1 memory di partenza + 2).
    expect(memory).toHaveLength(3);
    expect(r.warnings.some((w) => w.includes('8 pad'))).toBe(true);
    // Loop esportati come POSITION_MARK Type=4 con Start+End.
    expect(loops).toHaveLength(1);
    expect(loops[0]['@_End']).toBe('72.000');
  });

  it('scrive Location come file URL', () => {
    const out = join(tmp, 'rb.xml');
    writeRekordboxXml(db, out);
    const doc = parse(out);
    const tracks = doc.DJ_PLAYLISTS.COLLECTION.TRACK as Record<string, string>[];
    expect(tracks[0]['@_Location']).toMatch(/^file:\/\/localhost\//);
  });

  it('scrive una beatgrid TEMPO quando c è il BPM', () => {
    const out = join(tmp, 'rb.xml');
    writeRekordboxXml(db, out);
    const doc = parse(out);
    const tracks = doc.DJ_PLAYLISTS.COLLECTION.TRACK as Record<string, unknown>[];
    const withBpm = tracks.find((t) => t['@_AverageBpm'] && t['@_AverageBpm'] !== '');
    expect(withBpm).toBeDefined();
    const tempo = withBpm!.TEMPO as Record<string, string>;
    expect(tempo).toBeDefined();
    expect(tempo['@_Inizio']).toBe('0.000');
    expect(Number(tempo['@_Bpm'])).toBeGreaterThan(0);
    expect(tempo['@_Metro']).toBe('4/4');
  });
});

describe('writeTraktorNml', () => {
  it('produce NML con ENTRY per traccia', () => {
    const out = join(tmp, 'traktor.nml');
    const r = writeTraktorNml(db, out);
    expect(r.tracks).toBe(4);
    const doc = parse(out);
    expect(doc.NML['@_VERSION']).toBeDefined();
    expect(doc.NML.COLLECTION.ENTRY).toHaveLength(4);
  });

  it('esporta grid marker (TYPE 4) e memory cue (HOTCUE -1)', () => {
    const out = join(tmp, 'traktor.nml');
    writeTraktorNml(db, out);
    const doc = parse(out);
    const entries = doc.NML.COLLECTION.ENTRY as Record<string, unknown>[];
    const levels = entries.find((e) => String(e['@_TITLE']).startsWith('Levels'))!;
    const cues = ([] as Record<string, string>[]).concat(levels.CUE_V2 as never);
    expect(cues.some((c) => c['@_TYPE'] === '4')).toBe(true); // grid marker
    expect(cues.some((c) => c['@_HOTCUE'] === '-1')).toBe(true); // memory/loop non-hotcue
  });
});

describe('writeVirtualDjXml', () => {
  it('produce database XML con Song per traccia', () => {
    const out = join(tmp, 'vdj.xml');
    const r = writeVirtualDjXml(db, out);
    expect(r.tracks).toBe(4);
    const doc = parse(out);
    expect(doc.VirtualDJ_Database.Song).toHaveLength(4);
  });

  it('conserva le memory cue come marker remix invece di scartarle', () => {
    // Regressione: la catena if/else copriva solo hot e loop, quindi ogni
    // memory cue spariva senza traccia — cioè il 100% dei cue su una rotta
    // VirtualDJ→VirtualDJ, dove automix/remix vengono letti proprio come memory.
    const out = join(tmp, 'vdj.xml');
    writeVirtualDjXml(db, out);
    const doc = parse(out);
    const songs = doc.VirtualDJ_Database.Song as Record<string, unknown>[];
    const levels = songs.find((s) =>
      String((s.Tags as Record<string, string>)['@_Title']).startsWith('Levels')
    )!;
    const pois = ([] as Record<string, string>[]).concat(levels.Poi as never);
    const remix = pois.filter((p) => p['@_Type'] === 'remix');
    expect(remix.length).toBeGreaterThan(0);
    // La memory della fixture sta a 200.000 s → Pos in secondi.
    expect(remix.some((p) => Number(p['@_Pos']) === 200)).toBe(true);
  });

  it('dichiara nei warning ciò che non è rappresentabile', () => {
    const out = join(tmp, 'vdj.xml');
    const r = writeVirtualDjXml(db, out);
    expect(Array.isArray(r.warnings)).toBe(true);
    // La fixture ha una memory cue: dev'essere dichiarata, non silenziosa.
    expect(r.warnings.some((w) => w.toLowerCase().includes('memory'))).toBe(true);
  });

  it('scrive le playlist come file .vdjfolder accanto al database', () => {
    // In VirtualDJ le playlist NON stanno nel database.xml: sono file
    // separati sotto "Folders". Prima non le esportavamo affatto.
    const out = join(tmp, 'vdj.xml');
    const r = writeVirtualDjXml(db, out);
    expect(r.playlists).toBeGreaterThan(0);
    const dir = join(tmp, 'Folders');
    const files = readdirSync(dir).filter((f) => f.endsWith('.vdjfolder'));
    expect(files.length).toBe(r.playlists);
    const doc = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' }).parse(
      readFileSync(join(dir, files[0]), 'utf-8')
    );
    const songs = doc.VirtualFolder.song;
    const arr = Array.isArray(songs) ? songs : [songs];
    expect(arr.length).toBeGreaterThan(0);
    expect(arr[0]['@_path']).toBeTruthy();
  });

  it('riscrive il colore del cue quando presente nel pivot', () => {
    const out = join(tmp, 'vdj.xml');
    // Colore su un hot cue esistente: il reader VDJ lo sa rileggere.
    db.prepare(`UPDATE cues SET color = '#ff8800' WHERE cue_type = 'hot'`).run();
    writeVirtualDjXml(db, out);
    const doc = parse(out);
    const songs = doc.VirtualDJ_Database.Song as Record<string, unknown>[];
    const withColor = songs
      .flatMap((s) => ([] as Record<string, string>[]).concat((s.Poi ?? []) as never))
      .filter(Boolean)
      .filter((p) => p['@_Color'] === '#FF8800');
    expect(withColor.length).toBeGreaterThan(0);
  });
});
