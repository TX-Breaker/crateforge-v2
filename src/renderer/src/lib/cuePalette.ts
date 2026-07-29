/**
 * Palette dei cue — otto slot, ordine fisso (design system §5.1 e §8.1).
 *
 * È l'unica fonte: il sidecar deve emettere QUESTI esadecimali e non i propri.
 * Le tinte sono desaturate sotto la soglia neon perché devono restare
 * distinguibili anche in scala di grigi, e perché un marker che spara più
 * dell'accento ruba la gerarchia a tutta la schermata.
 *
 * La legenda che accompagna la forma d'onda non è ornamento: otto tinte a 9px
 * non si distinguono a colpo d'occhio, quindi la legenda è ciò che rende
 * leggibili le bandierine — ed è l'unico posto in cui il legame fra colore e
 * significato viene dichiarato.
 */

export interface CueSlot {
  /** posizione nell'ordine dichiarato, 1-8 */
  slot: number;
  /** chiave stabile, usata anche dal sidecar nelle etichette */
  id: 'intro' | 'build' | 'drop' | 'breakdown' | 'drop2' | 'outro' | 'vocal' | 'loop';
  hex: string;
  /** etichetta inglese come la emette l'analizzatore */
  label: string;
}

export const CUE_PALETTE: readonly CueSlot[] = [
  { slot: 1, id: 'intro', hex: '#6C9BC9', label: 'Intro' },
  { slot: 2, id: 'build', hex: '#5E9E72', label: 'Build' },
  { slot: 3, id: 'drop', hex: '#E8912E', label: 'Drop' },
  { slot: 4, id: 'breakdown', hex: '#8F8AC4', label: 'Breakdown' },
  { slot: 5, id: 'drop2', hex: '#C4776B', label: 'Second drop' },
  { slot: 6, id: 'outro', hex: '#7FA8A0', label: 'Outro' },
  { slot: 7, id: 'vocal', hex: '#C4768F', label: 'Vocal' },
  { slot: 8, id: 'loop', hex: '#8F9A5E', label: 'Loop' }
] as const;

/** Gli otto esadecimali ammessi, in maiuscolo. Fuori da qui non si va. */
export const CUE_HEXES: readonly string[] = CUE_PALETTE.map((c) => c.hex);

/** true se il colore è uno degli otto dichiarati (confronto senza maiuscole). */
export function isDeclaredCueColor(hex: string | null | undefined): boolean {
  if (!hex) return false;
  const up = hex.trim().toUpperCase();
  return CUE_HEXES.includes(up);
}

/**
 * Bande di struttura sotto la forma d'onda (§8.1).
 *
 * I bordi delle bande sono percentuali della durata calcolate
 * dall'analizzatore, mai fissi. Solo le due bande di drop portano l'etichetta
 * colorata: è tutto il senso della tintura — se le colorassimo tutte, non
 * segnalerebbero più niente.
 */
export const BAND_STYLE: Record<
  string,
  { fill: string; fillOpacity: number; label: string }
> = {
  intro: { fill: '#6C9BC9', fillOpacity: 0.05, label: '#565C64' },
  build: { fill: '#5E9E72', fillOpacity: 0.05, label: '#565C64' },
  drop: { fill: '#E8912E', fillOpacity: 0.07, label: '#B9701F' },
  breakdown: { fill: '#8F8AC4', fillOpacity: 0.05, label: '#565C64' },
  drop2: { fill: '#E8912E', fillOpacity: 0.07, label: '#B9701F' },
  outro: { fill: '#7FA8A0', fillOpacity: 0.05, label: '#565C64' }
};

/** Dall'etichetta dell'analizzatore allo slot della palette. */
export function slotFromLabel(label: string | null | undefined): CueSlot | null {
  if (!label) return null;
  const l = label.trim().toLowerCase();
  return (
    CUE_PALETTE.find((c) => c.label.toLowerCase() === l || c.id === l) ??
    (l.startsWith('drop 2') || l.startsWith('second') ? CUE_PALETTE[4] : null)
  );
}
