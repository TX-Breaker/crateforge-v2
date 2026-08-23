import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { inflateSync } from 'zlib';
import { decodeBeatDataHeader } from '../src/adapters/engine/engineCodec';
import { readEngineLibrary } from '../src/adapters/engine/engineReader';

/**
 * `beatData` e i due BPM, verificati contro la libreria Engine REALE, in sola
 * lettura.
 *
 * ⚠ Nessun titolo, artista o percorso finisce negli asserti o nell'output.
 * Si auto-salta se Engine non è installato.
 */

const dbPath = join(homedir(), 'Music', 'Engine Library', 'Database2', 'm.db');
const disponibile = existsSync(dbPath);
const d = disponibile ? describe : describe.skip;

function apri() {
  return new Database(dbPath, { readonly: true, fileMustExist: true });
}

d('Engine DJ — beatData e i due BPM (libreria reale)', () => {
  it("l'intestazione di beatData si decodifica su tutte le tracce che ce l'hanno", () => {
    const db = apri();
    try {
      const rows = db
        .prepare(`SELECT beatData FROM PerformanceData WHERE beatData IS NOT NULL`)
        .all() as { beatData: Buffer }[];
      expect(rows.length).toBeGreaterThan(0);

      let ok = 0;
      let nonInterpretati = 0;
      for (const r of rows) {
        const header = decodeBeatDataHeader(inflateSync(r.beatData.subarray(4)));
        expect(header, 'intestazione non decodificabile').not.toBeNull();
        // Sample rate plausibile e durata credibile: sono i due controlli che
        // distinguono un blob valido da uno con un layout diverso.
        expect(header!.sampleRate).toBeGreaterThanOrEqual(8000);
        expect(header!.sampleRate).toBeLessThanOrEqual(192000);
        expect(header!.totalSamples).toBeGreaterThan(0);
        nonInterpretati += header!.unparsedBytes;
        ok++;
      }
      console.log(
        `[engine] ${ok} intestazioni beatData lette, ` +
          `${Math.round(nonInterpretati / ok)} byte per traccia restano non interpretati`
      );
    } finally {
      db.close();
    }
  });

  it('⚠ i due double sono BIG-endian: letti come uint32 darebbero un numero plausibile e falso', () => {
    const db = apri();
    try {
      const r = db
        .prepare(`SELECT beatData FROM PerformanceData WHERE beatData IS NOT NULL LIMIT 1`)
        .get() as { beatData: Buffer };
      const raw = inflateSync(r.beatData.subarray(4));

      const corretto = raw.readDoubleBE(0);
      const sbagliato = raw.readUInt32BE(0);
      expect(corretto).toBeGreaterThanOrEqual(8000);
      expect(corretto).toBeLessThanOrEqual(192000);
      // 1088421504 sembra un numero, e non è un sample rate: è il motivo per
      // cui l'errore non si nota finché le posizioni non risultano assurde.
      expect(sbagliato).toBeGreaterThan(1_000_000);
    } finally {
      db.close();
    }
  });

  it('beatData e trackData concordano sulla sample rate', () => {
    const db = apri();
    try {
      const rows = db
        .prepare(
          `SELECT beatData, trackData FROM PerformanceData
            WHERE beatData IS NOT NULL AND trackData IS NOT NULL`
        )
        .all() as { beatData: Buffer; trackData: Buffer }[];

      let confrontate = 0;
      for (const r of rows) {
        const dalBeat = decodeBeatDataHeader(inflateSync(r.beatData.subarray(4)))?.sampleRate;
        const dalTrack = inflateSync(r.trackData.subarray(4)).readDoubleBE(0);
        if (dalBeat === undefined) continue;
        // Sono due fonti indipendenti dello stesso dato: se divergessero, una
        // delle due letture sarebbe sbagliata.
        expect(dalBeat).toBe(dalTrack);
        confrontate++;
      }
      expect(confrontate).toBeGreaterThan(0);
    } finally {
      db.close();
    }
  });

  it('il corpo dei marker resta dichiaratamente non interpretato', () => {
    // Il test difende una DECISIONE, non un comportamento: finché il layout dei
    // marker non è confermato, da qui non esce un'ancora di griglia. Se un
    // giorno la si implementa, questo test va cambiato apposta.
    const db = apri();
    try {
      const r = db
        .prepare(`SELECT beatData FROM PerformanceData WHERE beatData IS NOT NULL LIMIT 1`)
        .get() as { beatData: Buffer };
      const header = decodeBeatDataHeader(inflateSync(r.beatData.subarray(4)));
      expect(header!.unparsedBytes).toBeGreaterThan(0);
    } finally {
      db.close();
    }
  });

  it('rifiuta un blob che non ha la forma attesa invece di inventare numeri', () => {
    expect(decodeBeatDataHeader(Buffer.alloc(4))).toBeNull();
    expect(decodeBeatDataHeader(Buffer.alloc(17))).toBeNull(); // sample rate 0
    const assurdo = Buffer.alloc(17);
    assurdo.writeDoubleBE(44100, 0);
    assurdo.writeDoubleBE(1e15, 8); // ~700 anni di audio
    expect(decodeBeatDataHeader(assurdo)).toBeNull();
  });

  it('il BPM dichiarato non viene più buttato via quando differisce dall’analizzato', () => {
    const lib = readEngineLibrary(dbPath);
    expect(lib.tracks.length).toBeGreaterThan(0);

    const conEntrambi = lib.tracks.filter(
      (t) => (t.formatData as Record<string, unknown> | undefined)?.bpmDeclared !== undefined
    );

    for (const t of conEntrambi) {
      const dichiarato = (t.formatData as Record<string, unknown>).bpmDeclared as number;
      // Si conserva solo quando dice qualcosa di diverso: una chiave che
      // ripete il valore già presente sarebbe rumore.
      expect(dichiarato).not.toBe(t.bpm);
      expect(Number.isFinite(dichiarato)).toBe(true);
    }

    console.log(
      `[engine] ${conEntrambi.length}/${lib.tracks.length} brani hanno un BPM dichiarato ` +
        'diverso da quello analizzato, ora conservato'
    );
  });

  it('il BPM esposto è quello ANALIZZATO, che è quello con cui Engine suona', () => {
    const db = apri();
    try {
      const cols = new Set(
        (db.prepare(`PRAGMA table_info(Track)`).all() as { name: string }[]).map((r) => r.name)
      );
      if (!cols.has('bpmAnalyzed')) return; // versione senza la distinzione

      const atteso = db
        .prepare(
          `SELECT id, bpmAnalyzed FROM Track WHERE bpmAnalyzed IS NOT NULL AND bpmAnalyzed > 0 LIMIT 1`
        )
        .get() as { id: number; bpmAnalyzed: number };

      const lib = readEngineLibrary(dbPath);
      const t = lib.tracks.find((x) => x.sourceId === String(atteso.id));
      expect(t?.bpm).toBe(atteso.bpmAnalyzed);
    } finally {
      db.close();
    }
  });
});
