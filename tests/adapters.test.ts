import { describe, expect, it } from 'vitest';
import { pathToLocation, kindFromPath } from '@adapters/common';
import { locationToPath } from '@core/xmlCollection';
import { CAMELOT_TO_TRAKTOR, TRAKTOR_KEY } from '@adapters/traktor/traktorKeys';
import { toCamelot } from '@core/camelot';

describe('pathToLocation ↔ locationToPath (round-trip)', () => {
  it('non percent-encoda il drive letter Windows', () => {
    const loc = pathToLocation('C:\\Music\\a b.mp3');
    expect(loc).toBe('file://localhost/C:/Music/a%20b.mp3');
    expect(locationToPath(loc)).toBe('C:\\Music\\a b.mp3');
  });

  it('round-trip su path POSIX con spazi e apostrofo', () => {
    const p = "/Users/x/Don't Stop.mp3";
    expect(locationToPath(pathToLocation(p))).toBe(p);
  });
});

describe('kindFromPath', () => {
  it('deriva il Kind Rekordbox dall estensione', () => {
    expect(kindFromPath('a.flac')).toBe('FLAC File');
    expect(kindFromPath('a.WAV')).toBe('WAV File');
    expect(kindFromPath('a.m4a')).toBe('M4A File');
    expect(kindFromPath(null)).toBe('MP3 File');
  });
});

describe('mappa key Traktor', () => {
  it('CAMELOT_TO_TRAKTOR è l inverso di TRAKTOR_KEY via Camelot', () => {
    // 21 = Am → Camelot 8A
    expect(toCamelot(TRAKTOR_KEY[21])).toBe('8A');
    expect(CAMELOT_TO_TRAKTOR['8A']).toBe(21);
    // 0 = C → 8B
    expect(CAMELOT_TO_TRAKTOR['8B']).toBe(0);
    // ogni indice 0-23 ha una Camelot mappata a ritroso
    for (let i = 0; i < 24; i++) {
      const cam = toCamelot(TRAKTOR_KEY[i]);
      expect(cam).not.toBeNull();
      expect(CAMELOT_TO_TRAKTOR[cam as string]).toBe(i);
    }
  });
});
