import { describe, expect, it } from 'vitest';
import {
  bpmDeltaPct,
  checkTransition,
  compatibleKeys,
  camelotToString,
  isCompatible,
  parseCamelot
} from '@core/harmony';

describe('parseCamelot', () => {
  it('accetta 1..12 + A/B, case-insensitive', () => {
    expect(parseCamelot('8A')).toEqual({ num: 8, letter: 'A' });
    expect(parseCamelot('12b')).toEqual({ num: 12, letter: 'B' });
    expect(parseCamelot('13A')).toBeNull();
    expect(parseCamelot('0B')).toBeNull();
    expect(parseCamelot(null)).toBeNull();
    expect(parseCamelot('Am')).toBeNull(); // non-Camelot: usare toCamelot prima
  });
});

describe('isCompatible (regola Camelot)', () => {
  const p = (s: string) => parseCamelot(s)!;
  it('stessa key, ±1 stessa lettera, stessa cifra lettera opposta', () => {
    expect(isCompatible(p('8A'), p('8A'))).toBe(true);
    expect(isCompatible(p('8A'), p('9A'))).toBe(true);
    expect(isCompatible(p('8A'), p('7A'))).toBe(true);
    expect(isCompatible(p('8A'), p('8B'))).toBe(true);
    expect(isCompatible(p('8A'), p('10A'))).toBe(false);
    expect(isCompatible(p('8A'), p('9B'))).toBe(false);
  });
  it("l'anello si chiude: 12 e 1 sono adiacenti", () => {
    expect(isCompatible(p('12A'), p('1A'))).toBe(true);
    expect(isCompatible(p('1B'), p('12B'))).toBe(true);
  });
});

describe('compatibleKeys', () => {
  it('4 posizioni, wrap corretto', () => {
    const keys = compatibleKeys(parseCamelot('1A')!).map(camelotToString);
    expect(keys.sort()).toEqual(['12A', '1A', '1B', '2A'].sort());
  });
});

describe('checkTransition', () => {
  it('flag key-clash e bpm-jump', () => {
    const r = checkTransition('8A', 128, '3B', 140);
    expect(r.flags).toContain('key-clash');
    expect(r.flags).toContain('bpm-jump');
    expect(r.keyOk).toBe(false);
    expect(r.bpmDelta).toBeCloseTo(9.375);
  });
  it('transizione pulita: nessun flag', () => {
    const r = checkTransition('8A', 128, '9A', 130);
    expect(r.flags).toEqual([]);
    expect(r.keyOk).toBe(true);
  });
  it('dati mancanti: flag dedicati, mai crash', () => {
    const r = checkTransition(null, null, '9A', 130);
    expect(r.flags).toContain('missing-key');
    expect(r.flags).toContain('missing-bpm');
    expect(r.keyOk).toBeNull();
    expect(r.bpmDelta).toBeNull();
  });

  it('bpm undefined/NaN al confine IPC: missing-bpm, non falso OK', () => {
    const r = checkTransition('8A', undefined, '9A', 130);
    expect(r.flags).toContain('missing-bpm');
    expect(r.bpmDelta).toBeNull();
    const r2 = checkTransition('8A', Number.NaN, '9A', 130);
    expect(r2.flags).toContain('missing-bpm');
  });
});

describe('bpmDeltaPct', () => {
  it('percentuale corretta e guardia sullo zero', () => {
    expect(bpmDeltaPct(100, 106)).toBeCloseTo(6);
    expect(bpmDeltaPct(0, 128)).toBe(Infinity);
  });
});
