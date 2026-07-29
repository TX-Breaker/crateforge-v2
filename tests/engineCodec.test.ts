import { describe, expect, it } from 'vitest';
import { existsSync } from 'fs';
import { homedir, tmpdir } from 'os';
import { join } from 'path';
import { copyFileSync, mkdtempSync, rmSync } from 'fs';
import Database from 'better-sqlite3';
import { readEngineLibrary } from '@adapters/engine/engineReader';
import {
  decodeLoops,
  decodeQuickCues,
  defaultTrailer,
  encodeLoops,
  encodeQuickCues,
  encodeTrackData,
  frameZlib,
  unframeZlib
} from '@adapters/engine/engineCodec';

/**
 * Il codec Engine deve essere REVERSIBILE: se ri-codifichiamo ciò che abbiamo
 * appena decodificato, il payload deve tornare byte-identico. È la condizione
 * che rende sicuro scrivere una libreria Engine — senza, staremmo inventando
 * byte dentro il database di un altro programma.
 *
 * I test sulla libreria reale si auto-saltano dove non c'è (CI, altre
 * macchine); quelli sintetici girano sempre.
 */

describe('codec Engine (sintetico)', () => {
  it('quickCues: round-trip di slot pieni e vuoti', () => {
    const qc = {
      slots: [
        { label: 'Cue 1', positionSamples: 883980.8782783931, color: '#F4D338' },
        null,
        { label: 'Drop', positionSamples: 1234567.5, color: '#1571E2' },
        null,
        null,
        null,
        null,
        null
      ],
      trailer: defaultTrailer()
    };
    const back = decodeQuickCues(encodeQuickCues(qc));
    expect(back.slots.map((s) => s?.label ?? null)).toEqual([
      'Cue 1', null, 'Drop', null, null, null, null, null
    ]);
    expect(back.slots[0]!.positionSamples).toBeCloseTo(883980.8782783931, 6);
    expect(back.slots[2]!.color).toBe('#1571E2');
    expect(back.trailer.length).toBe(17);
  });

  it('loops: round-trip con inizio, fine e colore', () => {
    const loops = [
      { label: 'Loop 1', startSamples: 219490.89, endSamples: 405828.92, color: '#F4D338' },
      null,
      { label: 'Loop 3', startSamples: 964843, endSamples: 1225716.24, color: '#AA55C4' },
      null,
      null,
      null,
      null,
      null
    ];
    const back = decodeLoops(encodeLoops(loops));
    expect(back[0]!.label).toBe('Loop 1');
    expect(back[0]!.startSamples).toBeCloseTo(219490.89, 6);
    expect(back[0]!.endSamples).toBeCloseTo(405828.92, 6);
    expect(back[2]!.color).toBe('#AA55C4');
    expect(back[1]).toBeNull();
  });

  it('il framing zlib dichiara la lunghezza decompressa esatta', () => {
    const payload = encodeTrackData(48000, 1_000_000);
    const framed = frameZlib(payload);
    expect(framed.readUInt32BE(0)).toBe(payload.length);
    expect(framed[4]).toBe(0x78); // magic zlib
    expect(unframeZlib(framed).equals(payload)).toBe(true);
  });

  it('tronca le etichette lunghe senza spezzare i caratteri accentati', () => {
    // La lunghezza è un uint8: oltre 255 byte va troncata, ma un accento
    // tagliato a metà produrrebbe byte UTF-8 non validi.
    const long = 'à'.repeat(200); // 400 byte in UTF-8
    const enc = encodeQuickCues({
      slots: [{ label: long, positionSamples: 1000, color: '#FFFFFF' }],
      trailer: defaultTrailer()
    });
    const back = decodeQuickCues(enc);
    expect(Buffer.byteLength(back.slots[0]!.label, 'utf8')).toBeLessThanOrEqual(255);
    expect(back.slots[0]!.label.endsWith('à')).toBe(true); // nessun carattere spezzato
  });
});

const ENGINE_DB = join(homedir(), 'Music', 'Engine Library', 'Database2', 'm.db');

describe.skipIf(!existsSync(ENGINE_DB))('percorsi dei brani nella libreria Engine', () => {
  it('risolve i path relativi su file che esistono davvero', () => {
    // Regressione: i path Engine sono relativi alla cartella "Engine Library",
    // non a quella che la contiene. Risalendo un livello di troppo, in Engine
    // TUTTE le tracce risultano "unavailable" (rosse) e non si caricano.
    const lib = readEngineLibrary(ENGINE_DB);
    const withPath = lib.tracks.filter((t) => t.path);
    const found = withPath.filter((t) => existsSync(t.path!));
    console.log(`[path] ${found.length}/${withPath.length} percorsi risolvono su file esistenti`);
    if (found.length < withPath.length) {
      const miss = withPath.find((t) => !existsSync(t.path!));
      console.log(`[path] esempio non risolto: ${miss?.path}`);
    }
    // Sulla libreria reale i file ci sono: se non li troviamo, la base è sbagliata.
    expect(found.length).toBeGreaterThan(withPath.length * 0.9);
  });
});

describe.skipIf(!existsSync(ENGINE_DB))('codec Engine contro la libreria reale', () => {
  it('ri-codifica ogni blob reale ottenendo gli stessi byte', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'cf-codec-'));
    try {
      const copy = join(tmp, 'm.db');
      copyFileSync(ENGINE_DB, copy);
      const db = new Database(copy, { readonly: true });
      const rows = db
        .prepare('SELECT trackId, quickCues, loops FROM PerformanceData')
        .all() as { trackId: number; quickCues: Buffer | null; loops: Buffer | null }[];

      let qcOk = 0;
      let qcTot = 0;
      let loopOk = 0;
      let loopTot = 0;
      let loopsWithData = 0;
      for (const r of rows) {
        if (r.quickCues && r.quickCues.length > 6) {
          qcTot++;
          const payload = unframeZlib(r.quickCues);
          if (encodeQuickCues(decodeQuickCues(payload)).equals(payload)) qcOk++;
        }
        if (r.loops && r.loops.length >= 8) {
          loopTot++;
          const decoded = decodeLoops(r.loops);
          if (decoded.some(Boolean)) loopsWithData++;
          if (encodeLoops(decoded).equals(r.loops)) loopOk++;
        }
      }
      db.close();
      console.log(
        `[codec] quickCues ${qcOk}/${qcTot} identici · loops ${loopOk}/${loopTot} identici (${loopsWithData} tracce con loop reali)`
      );
      // Il criterio: nessun byte inventato, su nessuna traccia.
      expect(qcOk).toBe(qcTot);
      expect(loopOk).toBe(loopTot);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }, 120_000);
});
