import { describe, expect, it } from 'vitest';
import {
  beatgridFromMarkers,
  decodeBeatData,
  type EngineBeatMarker
} from '../src/adapters/engine/engineCodec';

/**
 * Griglia di Engine su blob sintetici: gira anche dove Engine non è installato.
 * La verifica sulla libreria reale sta in `realEngineBeatData.test.ts`.
 */

const SR = 44100;

function blob(def: EngineBeatMarker[], adj: EngineBeatMarker[], totalSamples = SR * 200): Buffer {
  const head = Buffer.alloc(17);
  head.writeDoubleBE(SR, 0);
  head.writeDoubleBE(totalSamples, 8);
  const grid = (ms: EngineBeatMarker[]) => {
    const b = Buffer.alloc(8 + ms.length * 24);
    b.writeBigUInt64BE(BigInt(ms.length), 0);
    ms.forEach((m, i) => {
      const o = 8 + i * 24;
      b.writeDoubleLE(m.positionSamples, o);
      b.writeBigInt64LE(BigInt(m.beatIndex), o + 8);
      b.writeUInt32LE(m.beatsToNext, o + 16);
    });
    return b;
  };
  return Buffer.concat([head, grid(def), grid(adj), Buffer.alloc(9)]);
}

/** Due marker come quelli reali: il primo a indice -4, prima dell'inizio. */
function marcatori(bpm: number, anchorS: number, beats = 400): EngineBeatMarker[] {
  const spb = 60 / bpm;
  return [
    { positionSamples: (anchorS - 4 * spb) * SR, beatIndex: -4, beatsToNext: beats + 4 },
    { positionSamples: (anchorS + beats * spb) * SR, beatIndex: beats, beatsToNext: 0 }
  ];
}

describe('Engine — griglia da beatData', () => {
  it('ricava BPM e ancora sul battito 0, non sul primo marker', () => {
    /* Il primo marker sta a indice -4, cioè prima dell'inizio del file. Usarlo
       come ancora darebbe un istante negativo, e chi lo azzerasse sposterebbe
       la griglia di quattro battiti. */
    const ms = marcatori(71, 0.329);
    const g = beatgridFromMarkers(ms, SR)!;
    expect(g.bpm).toBeCloseTo(71, 6);
    expect(g.anchorMs).toBeCloseTo(329, 3);
    expect(g.variable).toBe(false);
  });

  it('legge i marker little-endian dopo un’intestazione big-endian', () => {
    const bd = decodeBeatData(blob(marcatori(128, 0.1), marcatori(128, 0.25)))!;
    expect(bd).not.toBeNull();
    expect(bd.sampleRate).toBe(SR);
    expect(bd.defaultGrid).toHaveLength(2);
    // È la griglia CORRETTA quella che l'utente vede in Engine.
    expect(beatgridFromMarkers(bd.adjustedGrid, SR)!.anchorMs).toBeCloseTo(250, 3);
    expect(bd.unparsedBytes).toBe(9);
  });

  it('dichiara una griglia a tempo variabile invece di farla passare per costante', () => {
    const spb = 60 / 120;
    const ms: EngineBeatMarker[] = [
      { positionSamples: 0, beatIndex: 0, beatsToNext: 64 },
      { positionSamples: 64 * spb * SR, beatIndex: 64, beatsToNext: 64 },
      // da qui 125 BPM
      { positionSamples: (64 * spb + 64 * (60 / 125)) * SR, beatIndex: 128, beatsToNext: 0 }
    ];
    const g = beatgridFromMarkers(ms, SR)!;
    expect(g.variable).toBe(true);
    expect(g.bpm).toBeCloseTo(120, 6);
  });

  it('rifiuta un blob letto di traverso invece di inventare una griglia', () => {
    const buono = blob(marcatori(128, 0.1), marcatori(128, 0.1));
    // conteggio di marker assurdo
    const rotto = Buffer.from(buono);
    rotto.writeBigUInt64BE(BigInt(5_000_000), 17);
    expect(decodeBeatData(rotto)).toBeNull();
    // troncato a metà di un marker
    expect(decodeBeatData(buono.subarray(0, 17 + 8 + 10))).toBeNull();
    // marker non crescenti
    expect(
      beatgridFromMarkers(
        [
          { positionSamples: 1000, beatIndex: 4, beatsToNext: 1 },
          { positionSamples: 500, beatIndex: 5, beatsToNext: 0 }
        ],
        SR
      )
    ).toBeNull();
  });
});
