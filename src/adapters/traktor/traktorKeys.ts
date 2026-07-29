import { toCamelot } from '@core/camelot';

/**
 * Mappa delle tonalità Traktor. In NML MUSICAL_KEY@VALUE è un INTERO 0-23
 * (0-11 maggiori C…B, 12-23 minori), non testo. Condivisa tra reader e writer
 * per evitare che la key si perda nel round-trip.
 */
export const TRAKTOR_KEY: Record<number, string> = {
  0: 'C', 1: 'C#', 2: 'D', 3: 'D#', 4: 'E', 5: 'F', 6: 'F#', 7: 'G',
  8: 'G#', 9: 'A', 10: 'A#', 11: 'B',
  12: 'Cm', 13: 'C#m', 14: 'Dm', 15: 'D#m', 16: 'Em', 17: 'Fm',
  18: 'F#m', 19: 'Gm', 20: 'G#m', 21: 'Am', 22: 'A#m', 23: 'Bm'
};

/** Camelot ("8A") → indice Traktor 0-23, derivato dalla mappa sopra. */
export const CAMELOT_TO_TRAKTOR: Record<string, number> = (() => {
  const m: Record<string, number> = {};
  for (const [idx, text] of Object.entries(TRAKTOR_KEY)) {
    const cam = toCamelot(text);
    if (cam) m[cam] = Number(idx);
  }
  return m;
})();
