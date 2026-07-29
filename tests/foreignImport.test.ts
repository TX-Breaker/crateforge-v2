import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import Database from 'better-sqlite3';
import { migrate, getSchemaVersion, SCHEMA_VERSION } from '@core/schema';
import { importForeignLibrary } from '@core/foreignImport';
import { readTraktorNml, traktorLocationToPath } from '@adapters/traktor/nmlReader';
import { readVirtualDjXml, vdjBpm } from '@adapters/virtualdj/vdjReader';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cf-foreign-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function memDb() {
  const db = new Database(':memory:');
  migrate(db);
  return db;
}

const NML = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<NML VERSION="19">
<HEAD COMPANY="x" PROGRAM="Traktor"/>
<COLLECTION ENTRIES="2">
  <ENTRY TITLE="Levels" ARTIST="Avicii">
    <LOCATION DIR="/:Music/:House/:" FILE="levels.mp3" VOLUME="C:"/>
    <ALBUM TITLE="Album1"/>
    <INFO GENRE="House" PLAYTIME="203" KEY="8A"/>
    <TEMPO BPM="126.000000"/>
    <MUSICAL_KEY VALUE="21"/>
    <CUE_V2 NAME="Intro" TYPE="0" START="500.000000" LEN="0.000000" HOTCUE="0"/>
    <CUE_V2 NAME="Loop1" TYPE="5" START="1000.000000" LEN="2000.000000" HOTCUE="-1"/>
    <CUE_V2 NAME="Grid" TYPE="4" START="0.000000" LEN="0.000000" HOTCUE="-1"/>
  </ENTRY>
  <ENTRY TITLE="Strobe" ARTIST="Deadmau5">
    <LOCATION DIR="/:Music/:" FILE="strobe.mp3" VOLUME="C:"/>
    <TEMPO BPM="128.000000"/>
  </ENTRY>
</COLLECTION>
<PLAYLISTS>
  <NODE TYPE="FOLDER" NAME="$ROOT"><SUBNODES COUNT="1">
    <NODE TYPE="PLAYLIST" NAME="Set1"><PLAYLIST ENTRIES="1" TYPE="LIST" UUID="u1">
      <ENTRY><PRIMARYKEY TYPE="TRACK" KEY="C:/:Music/:House/:levels.mp3"/></ENTRY>
    </PLAYLIST></NODE>
  </SUBNODES></NODE>
</PLAYLISTS>
</NML>`;

const VDJ = `<?xml version="1.0" encoding="UTF-8"?>
<VirtualDJ_Database Version="2024">
  <Song FilePath="C:\\Music\\track.mp3" FileSize="5000000">
    <Tags Author="Fisher" Title="Losing It" Genre="Tech House" Year="2018" Bpm="0.5" Key="Am"/>
    <Infos SongLength="200"/>
    <Poi Pos="1.5" Type="cue" Num="1" Name="Drop"/>
    <Poi Pos="10.0" Type="loop" Size="4.0" Name="L1"/>
    <Poi Pos="0.0" Type="beatgrid"/>
  </Song>
</VirtualDJ_Database>`;

describe('schema v4', () => {
  it('migra e accetta source di altri software', () => {
    const db = memDb();
    expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION);
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(4);
    // source non più vincolato a masterdb/xml
    db.prepare(`INSERT INTO tracks (source, source_id, title) VALUES ('traktor', 'k', 'T')`).run();
    db.prepare(`INSERT INTO playlists (source, name) VALUES ('virtualdj', 'P')`).run();
    expect((db.prepare(`SELECT COUNT(*) c FROM tracks`).get() as { c: number }).c).toBe(1);
  });
});

describe('traktorLocationToPath', () => {
  it('ricostruisce path Windows e mac', () => {
    expect(traktorLocationToPath('C:', '/:Music/:House/:', 'a.mp3')).toBe('C:\\Music\\House\\a.mp3');
    expect(traktorLocationToPath('', '/:Users/:x/:', 'a.mp3')).toBe('/Users/x/a.mp3');
  });
});

describe('readTraktorNml + import', () => {
  it('legge brani, cue, key, playlist e li scrive nell UDM', () => {
    const p = join(dir, 'collection.nml');
    writeFileSync(p, NML, 'utf-8');
    const lib = readTraktorNml(p);
    expect(lib.source).toBe('traktor');
    expect(lib.tracks).toHaveLength(2);
    const levels = lib.tracks[0];
    expect(levels.title).toBe('Levels');
    expect(levels.path).toBe('C:\\Music\\House\\levels.mp3');
    expect(levels.bpm).toBe(126);
    expect(levels.musicalKey).toBe('8A');
    // grid (TYPE 4) escluso; restano hot + loop
    expect(levels.cues).toHaveLength(2);
    expect(levels.cues.find((c) => c.type === 'hot')?.index).toBe(0);
    expect(levels.cues.find((c) => c.type === 'loop')?.lengthMs).toBe(2000);
    expect(lib.playlists).toHaveLength(1);
    expect(lib.playlists[0].trackSourceIds).toContain('C:/:Music/:House/:levels.mp3');

    const db = memDb();
    const r = importForeignLibrary(db, lib);
    expect(r.tracks).toBe(2);
    expect(r.cues).toBe(2);
    expect(r.playlists).toBe(1);
    const row = db.prepare(`SELECT camelot FROM tracks WHERE title='Levels'`).get() as { camelot: string };
    expect(row.camelot).toBe('8A');
    // la playlist ha il brano collegato
    const linked = db.prepare(`SELECT COUNT(*) c FROM playlist_tracks`).get() as { c: number };
    expect(linked.c).toBe(1);
  });

  it('re-import idempotente per source_id', () => {
    const p = join(dir, 'c.nml');
    writeFileSync(p, NML, 'utf-8');
    const db = memDb();
    importForeignLibrary(db, readTraktorNml(p));
    importForeignLibrary(db, readTraktorNml(p));
    expect((db.prepare(`SELECT COUNT(*) c FROM tracks`).get() as { c: number }).c).toBe(2);
  });
});

describe('vdjBpm', () => {
  it('decodifica secondi-per-beat e BPM diretti', () => {
    expect(vdjBpm('0.5')).toBe(120);
    expect(vdjBpm('128')).toBe(128);
    expect(vdjBpm('0')).toBeNull();
    expect(vdjBpm(undefined)).toBeNull();
  });
});

describe('readVirtualDjXml + import', () => {
  it('legge brano, bpm, cue/loop; playlist vuote con avviso', () => {
    const p = join(dir, 'database.xml');
    writeFileSync(p, VDJ, 'utf-8');
    const lib = readVirtualDjXml(p);
    expect(lib.source).toBe('virtualdj');
    expect(lib.tracks).toHaveLength(1);
    const t = lib.tracks[0];
    expect(t.artist).toBe('Fisher');
    expect(t.bpm).toBe(120);
    expect(t.path).toBe('C:\\Music\\track.mp3');
    // cue + loop, beatgrid escluso
    expect(t.cues).toHaveLength(2);
    expect(t.cues.find((c) => c.type === 'loop')?.lengthMs).toBe(4000);
    expect(lib.warnings.some((w) => w.includes('.vdjfolder'))).toBe(true);

    const db = memDb();
    const r = importForeignLibrary(db, lib);
    expect(r.tracks).toBe(1);
    expect(r.cues).toBe(2);
  });
});
