/**
 * Tinte e nomi delle dodici tonalità Camelot (§5.2).
 *
 * Sono DATI, non componenti: stanno qui e non dentro la ruota perché le usano
 * anche la copertura tonalità e i test di contrasto, e un dato che vive dentro
 * un file .tsx si può leggere solo montando React.
 *
 * Le tinte sono quelle campionate dalla ruota Mixed In Key, chiave 1 → 12: i
 * DJ le leggono già, e cambiarle costerebbe più di quanto renderebbe. Sono
 * sature, quindi non vanno MAI dipinte così come sono: passano sempre da
 * `aaSafe`/`ensureReadable` contro il fondo su cui finiscono, ed è lì che il
 * divieto di neon (§07) viene rispettato.
 */

export const CAMELOT_HUES = [
  '#7FE8B0',
  '#A8F58A',
  '#C4E878',
  '#E2BE78',
  '#F79486',
  '#F9849E',
  '#E484C6',
  '#C684EE',
  '#AE8CFF',
  '#9BBCFF',
  '#8AEBFC',
  '#88FFEE'
] as const;

export const CAMELOT_KEYNAMES: Record<'A' | 'B', string[]> = {
  A: [
    'A♭ min',
    'E♭ min',
    'B♭ min',
    'F min',
    'C min',
    'G min',
    'D min',
    'A min',
    'E min',
    'B min',
    'F♯ min',
    'D♭ min'
  ],
  B: [
    'B maj',
    'F♯ maj',
    'D♭ maj',
    'A♭ maj',
    'E♭ maj',
    'B♭ maj',
    'F maj',
    'C maj',
    'G maj',
    'D maj',
    'A maj',
    'E maj'
  ]
};
