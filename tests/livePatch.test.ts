import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import Database from 'better-sqlite3';
import { patchTraktorNml } from '../src/adapters/traktor/nmlPatch';
import { patchVirtualDjXml } from '../src/adapters/virtualdj/vdjPatch';
import { engineKeyOf, patchEngineTracks } from '../src/adapters/engine/enginePatch';
import { readTraktorNml } from '../src/adapters/traktor/nmlReader';
import { readVirtualDjXml } from '../src/adapters/virtualdj/vdjReader';
import { getAttr, setAttr, xmlDecode, xmlEncode } from '../src/adapters/livePatch';

/**
 * Aggiornamento sul posto delle librerie dei programmi.
 *
 * ⚠ Il test che conta è «tutto il resto resta identico»: scrivere nella
 * libreria viva di un altro programma è accettabile solo se ciò che non stiamo
 * sincronizzando — brani sconosciuti, cue, playlist, attributi ignoti — non
 * cambia di un byte. Le fixture sono sintetiche.
 */

const tmp = () => mkdtempSync(join(tmpdir(), 'cf-patch-'));

const NML = `<?xml version="1.0" encoding="UTF-8" standalone="no" ?>
<NML VERSION="19"><HEAD COMPANY="www.native-instruments.com" PROGRAM="Traktor"></HEAD>
<COLLECTION ENTRIES="2">
<ENTRY MODIFIED_DATE="2026/7/1" MODIFIED_TIME="100" TITLE="Old Title" ARTIST="Synth &amp; Co"><LOCATION DIR="/:Music/:" FILE="a.mp3" VOLUME="C:" VOLUMEID="C:"></LOCATION>
<ALBUM TITLE="Old Album"></ALBUM><MODIFICATION_INFO AUTHOR_TYPE="user"></MODIFICATION_INFO><INFO BITRATE="320000" GENRE="House" KEY="Am" PLAYTIME="300" FILESIZE="9000" UNKNOWN_ATTR="keep"></INFO><TEMPO BPM="120.000000" BPM_QUALITY="100.000000"></TEMPO><MUSICAL_KEY VALUE="21"></MUSICAL_KEY><CUE_V2 NAME="Cue 1" TYPE="0" START="1000.000" LEN="0.000000" HOTCUE="0"></CUE_V2>
</ENTRY>
<ENTRY TITLE="Untouched" ARTIST="Other"><LOCATION DIR="/:Music/:" FILE="b.mp3" VOLUME="C:" VOLUMEID="C:"></LOCATION>
<INFO GENRE="Techno"></INFO></ENTRY>
</COLLECTION>
<PLAYLISTS><NODE TYPE="FOLDER" NAME="$ROOT"></NODE></PLAYLISTS>
</NML>
`;

describe('strumenti XML', () => {
  it('codifica e decodifica sono l’una l’inverso dell’altra', () => {
    const s = 'A & B <"C"> \'d\'';
    expect(xmlDecode(xmlEncode(s))).toBe(s);
  });

  it('setAttr sostituisce sul posto o aggiunge in fondo', () => {
    expect(setAttr('<X A="1" B="2">', 'A', '9')).toBe('<X A="9" B="2">');
    expect(setAttr('<X A="1"/>', 'C', 'z')).toBe('<X A="1" C="z"/>');
    expect(getAttr('<X A="R&amp;B">', 'A')).toBe('R&B');
  });

  it('un attributo con un nome che ne contiene un altro non si confonde', () => {
    expect(setAttr('<X SUBTITLE="s" TITLE="t">', 'TITLE', 'n')).toBe('<X SUBTITLE="s" TITLE="n">');
  });
});

describe('Traktor — collection.nml sul posto', () => {
  const key = 'C:/:Music/:a.mp3';

  it('aggiorna solo i campi chiesti, nel brano chiesto', () => {
    const r = patchTraktorNml(
      NML,
      new Map([[key, { title: 'New & Title', genre: 'Deep House', bpm: 124, camelot: '8A', year: 2021 }]])
    );
    expect(r.patched).toBe(1);
    expect(r.missing).toEqual([]);
    const dir = tmp();
    const p = join(dir, 'collection.nml');
    writeFileSync(p, r.text);
    const lib = readTraktorNml(p);
    const a = lib.tracks.find((t) => t.sourceId === key)!;
    expect(a.title).toBe('New & Title');
    expect(a.genre).toBe('Deep House');
    expect(a.bpm).toBe(124);
    expect(a.year).toBe(2021);
    expect(a.artist).toBe('Synth & Co'); // non chiesto: invariato
    expect(a.cues).toHaveLength(1);
    expect(lib.tracks.find((t) => t.title === 'Untouched')!.genre).toBe('Techno');
  });

  it('⚠ tutto ciò che non è sincronizzato resta byte per byte', () => {
    const r = patchTraktorNml(NML, new Map([[key, { genre: 'Garage' }]]));
    expect(r.text.replace('GENRE="Garage"', 'GENRE="House"')).toBe(NML);
  });

  it('⚠ non tocca il segnale di modifica di Traktor', () => {
    const r = patchTraktorNml(NML, new Map([[key, { title: 'X' }]]));
    expect(r.text).toContain('MODIFIED_DATE="2026/7/1" MODIFIED_TIME="100"');
  });

  it('aggiunge un elemento mancante solo se c’è un valore', () => {
    const k2 = 'C:/:Music/:b.mp3';
    const r = patchTraktorNml(NML, new Map([[k2, { album: 'Nuovo', bpm: 130 }]]));
    const dir = tmp();
    const p = join(dir, 'c.nml');
    writeFileSync(p, r.text);
    const b = readTraktorNml(p).tracks.find((t) => t.sourceId === k2)!;
    expect(b.album).toBe('Nuovo');
    expect(b.bpm).toBe(130);
  });

  it('dice quali brani non ha trovato', () => {
    const r = patchTraktorNml(NML, new Map([['C:/:Music/:gone.mp3', { title: 'x' }]]));
    expect(r.patched).toBe(0);
    expect(r.missing).toEqual(['C:/:Music/:gone.mp3']);
    expect(r.text).toBe(NML);
  });
});

const VDJ = `<?xml version="1.0" encoding="UTF-8"?>
<VirtualDJ_Database Version="2023">
 <Song FilePath="C:\\Music\\a.mp3" FileSize="1000">
  <Tags Author="Old" Title="T1" Genre="House" Bpm="0.500000" Flag="1" />
  <Infos SongLength="300.0" />
  <Scan Version="801" Bpm="0.500000" Key="Am" />
  <Poi Pos="1.0" Type="cue" Num="1" />
 </Song>
 <Song FilePath="C:\\Music\\b.mp3" FileSize="2000" />
</VirtualDJ_Database>
`;

describe('VirtualDJ — database.xml sul posto', () => {
  it('aggiorna i tag e conserva il formato del tempo', () => {
    const r = patchVirtualDjXml(VDJ, new Map([['C:\\Music\\a.mp3', { artist: 'New', bpm: 128 }]]));
    expect(r.patched).toBe(1);
    expect(r.text).toContain('Bpm="0.468750"'); // secondi per battito, come c'era
    expect(r.text).toContain('<Scan Version="801" Bpm="0.500000" Key="Am" />'); // analisi intatta
    const dir = tmp();
    const p = join(dir, 'database.xml');
    writeFileSync(p, r.text);
    const a = readVirtualDjXml(p).tracks.find((t) => t.path === 'C:\\Music\\a.mp3')!;
    expect(a.artist).toBe('New');
    expect(a.bpm).toBeCloseTo(128, 3);
    expect(a.cues).toHaveLength(1);
  });

  it('un brano senza Tags riceve i suoi tag senza rompere il file', () => {
    const r = patchVirtualDjXml(VDJ, new Map([['C:\\Music\\b.mp3', { title: 'B', year: 2020 }]]));
    const dir = tmp();
    const p = join(dir, 'database.xml');
    writeFileSync(p, r.text);
    const b = readVirtualDjXml(p).tracks.find((t) => t.path === 'C:\\Music\\b.mp3')!;
    expect(b.title).toBe('B');
    expect(b.year).toBe(2020);
  });
});

describe('Engine — Track sul posto', () => {
  it('la tonalità segue l’ordine Camelot di Engine', () => {
    expect(engineKeyOf('1B')).toBe(0);
    expect(engineKeyOf('1A')).toBe(1);
    expect(engineKeyOf('8A')).toBe(15);
    expect(engineKeyOf('12A')).toBe(23);
    expect(engineKeyOf('Am')).toBeNull();
  });

  it('scrive solo le colonne che lo schema ha, in una transazione', () => {
    const db = new Database(':memory:');
    db.exec(`CREATE TABLE Track (id INTEGER PRIMARY KEY, title TEXT, artist TEXT, genre TEXT, bpm INTEGER, bpmAnalyzed REAL, key INTEGER)`);
    db.prepare(`INSERT INTO Track (id, title, artist, genre, bpm, bpmAnalyzed, key) VALUES (7, 'a', 'b', 'c', 120, 120.0, 0)`).run();
    const r = patchEngineTracks(db, new Map([['7', { title: 'Nuovo', album: 'senza colonna', bpm: 127.5, camelot: '8A' }], ['99', { title: 'x' }]]));
    expect(r).toEqual({ patched: 1, missing: ['99'] });
    expect(db.prepare(`SELECT * FROM Track WHERE id = 7`).get()).toEqual({
      id: 7, title: 'Nuovo', artist: 'b', genre: 'c', bpm: 128, bpmAnalyzed: 127.5, key: 15
    });
  });
});
