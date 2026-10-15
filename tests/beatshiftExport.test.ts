import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { migrate } from '../src/core/schema';
import { getCuesForTrack, previewBeatshift } from '../src/adapters/common';
import { writeRekordboxXml } from '../src/adapters/rekordbox/xmlWriter';
import type { Mp3Probe } from '../src/core/beatshift';

/**
 * La correzione dello scarto MP3 vista da chi esporta.
 *
 * Le regole che questi test difendono sono quelle che rendono la correzione
 * sicura nonostante una tabella non antisimmetrica:
 *  - si applica solo a ciò che si SCRIVE, mai all'archivio interno;
 *  - mai fra un software e se stesso;
 *  - è spenta se non la si chiede;
 *  - senza il caso del file non sposta niente.
 */

function db() {
  const d = new Database(':memory:');
  migrate(d);
  return d;
}

function brano(d: Database.Database, source: string, path: string, posMs = 1000): number {
  const id = Number(
    d
      .prepare(`INSERT INTO tracks (source, source_id, title, path) VALUES (?, ?, 'T', ?)`)
      .run(source, `${source}-${path}`, path).lastInsertRowid
  );
  d.prepare(
    `INSERT INTO cues (track_id, cue_type, cue_index, position_ms) VALUES (?, 'hot', 0, ?)`
  ).run(id, posMs);
  return id;
}

const caso = (c: Mp3Probe['case'] | null) => (): Mp3Probe | null =>
  c
    ? { case: c, evidence: { xing: true, lame: true, lameCrcOk: true, encoder: null, channelModeMatch: null } }
    : null;

describe('correzione dello scarto MP3 in uscita', () => {
  it('sposta i cue di un MP3 di caso B da Traktor a Rekordbox', () => {
    const d = db();
    const id = brano(d, 'traktor', 'C:/m/a.mp3');
    const cues = getCuesForTrack(d, id, undefined, { target: 'rekordbox', probe: caso('B') });
    expect(cues[0].position_ms).toBeCloseTo(974, 6);
  });

  it('non tocca l archivio interno', () => {
    // Lo spostamento esiste solo in ciò che si scrive: riletto dall'archivio,
    // il cue è quello importato. È ciò che impedisce alla deriva di accumularsi.
    const d = db();
    const id = brano(d, 'traktor', 'C:/m/a.mp3');
    getCuesForTrack(d, id, undefined, { target: 'rekordbox', probe: caso('B') });
    const raw = d.prepare(`SELECT position_ms FROM cues WHERE track_id = ?`).get(id) as { position_ms: number };
    expect(raw.position_ms).toBe(1000);
  });

  it('non sposta niente se non è richiesta', () => {
    const d = db();
    const id = brano(d, 'traktor', 'C:/m/a.mp3');
    expect(getCuesForTrack(d, id)[0].position_ms).toBe(1000);
    expect(getCuesForTrack(d, id, undefined, null)[0].position_ms).toBe(1000);
  });

  it('non sposta verso il software da cui il cue viene', () => {
    const d = db();
    const id = brano(d, 'masterdb', 'C:/m/a.mp3');
    const cues = getCuesForTrack(d, id, undefined, { target: 'rekordbox', probe: caso('B') });
    expect(cues[0].position_ms).toBe(1000);
  });

  it('non sposta un MP3 il cui caso non si conosce, né un formato senza frame informativo', () => {
    const d = db();
    const mp3 = brano(d, 'traktor', 'C:/m/a.mp3');
    const flac = brano(d, 'traktor', 'C:/m/b.flac');
    expect(getCuesForTrack(d, mp3, undefined, { target: 'rekordbox', probe: caso(null) })[0].position_ms).toBe(1000);
    expect(getCuesForTrack(d, flac, undefined, { target: 'rekordbox', probe: caso('B') })[0].position_ms).toBe(1000);
  });

  it('non porta un cue prima dell inizio del brano', () => {
    const d = db();
    const id = brano(d, 'traktor', 'C:/m/a.mp3', 10);
    const cues = getCuesForTrack(d, id, undefined, { target: 'rekordbox', probe: caso('B') });
    expect(cues[0].position_ms).toBe(0);
  });

  it('l anteprima conta brani, casi e spostamenti senza scrivere', () => {
    const d = db();
    brano(d, 'traktor', 'C:/m/a.mp3');
    brano(d, 'traktor', 'C:/m/b.mp3');
    brano(d, 'masterdb', 'C:/m/c.mp3');
    brano(d, 'traktor', 'C:/m/d.flac');
    const p = previewBeatshift(d, {}, 'rekordbox', caso('B'));
    expect(p.tracks).toBe(4);
    expect(p.sameApp).toBe(1);
    expect(p.byCase.B).toBe(2);
    expect(p.byCase.other).toBe(1);
    expect(p.shiftedCues).toBe(2);
    expect(p.shifts).toEqual([{ ms: -26, cues: 2 }]);
  });
});

/* ------------------------------------------------ export vero su file vero */

/** MP3 sintetico di caso B: frame Info senza LAME, channel mode diverso dall'audio. */
function mp3CasoB(): Buffer {
  const frame = (mode: number, info: boolean) => {
    const f = Buffer.alloc(417);
    Buffer.from([0xff, 0xfb, 0x90, (mode & 3) << 6]).copy(f, 0);
    if (info) f.write('Info', 36, 'latin1');
    return f;
  };
  return Buffer.concat([frame(1, true), frame(0, false), frame(0, false), frame(0, false)]);
}

describe('export Rekordbox XML con la correzione', () => {
  it('scrive il cue spostato solo quando l opzione è accesa', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'cf-bs-'));
    try {
      const mp3 = join(tmp, 'brano.mp3');
      writeFileSync(mp3, mp3CasoB());
      const d = db();
      brano(d, 'traktor', mp3, 1000);

      const spento = join(tmp, 'spento.xml');
      writeRekordboxXml(d, spento, {});
      expect(readFileSync(spento, 'utf-8')).toMatch(/Start="1\.000"/);

      const acceso = join(tmp, 'acceso.xml');
      writeRekordboxXml(d, acceso, { beatshift: true });
      expect(readFileSync(acceso, 'utf-8')).toMatch(/Start="0\.974"/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
