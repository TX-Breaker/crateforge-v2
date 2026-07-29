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
export interface BandStyle {
  /** tinta del riempimento: è un dato, uguale in tutte le palette */
  fill: string;
  /** .05 ovunque, .07 sui due drop — la differenza È il segnale */
  fillOpacity: number;
  /**
   * Ruolo dell'etichetta, non un esadecimale. Il documento la disegna
   * #565C64 e #B9701F: sono la resa in Studio Dark di `text.lo` e della
   * gradazione scura dell'accento, e scritte come tinte fisse
   * sopravviverebbero solo a quel tema. Come ruoli valgono in tutti e sei.
   */
  label: 'muted' | 'accent';
}

export const BAND_STYLE: Record<string, BandStyle> = {
  intro: { fill: '#6C9BC9', fillOpacity: 0.05, label: 'muted' },
  build: { fill: '#5E9E72', fillOpacity: 0.05, label: 'muted' },
  drop: { fill: '#E8912E', fillOpacity: 0.07, label: 'accent' },
  breakdown: { fill: '#8F8AC4', fillOpacity: 0.05, label: 'muted' },
  drop2: { fill: '#E8912E', fillOpacity: 0.07, label: 'accent' },
  outro: { fill: '#7FA8A0', fillOpacity: 0.05, label: 'muted' }
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

/**
 * Colore con cui DISEGNARE un cue — l'unico punto in cui la regola «nessun
 * colore fuori dagli otto» viene applicata davvero.
 *
 * I cue non arrivano solo dall'analizzatore: arrivano anche dalle librerie che
 * l'utente importa, e lì dentro c'è qualunque cosa (il verde acido di Serato,
 * il rosso pieno di Rekordbox). Dichiarare la palette e poi passare al canvas
 * il colore trovato nel file significa non averla dichiarata.
 *
 * Precedenza:
 *  1. l'etichetta, se corrisponde a uno slot — è il significato, e vince sul
 *     colore che il file si portava dietro;
 *  2. il colore, se è già uno degli otto;
 *  3. `null`, cioè "nessun colore": il componente usa il neutro del tema.
 *     Mai un nono colore inventato al volo.
 */
export function cueColor(cue: { label?: string | null; color?: string | null }): string | null {
  const bySlot = slotFromLabel(cue.label);
  if (bySlot) return bySlot.hex;
  if (isDeclaredCueColor(cue.color)) {
    const up = cue.color!.trim().toUpperCase();
    return CUE_HEXES.find((h) => h === up) ?? null;
  }
  return null;
}

/**
 * Stile della banda a partire dallo slot. `undefined` per gli slot che non
 * sono una sezione (vocal, loop): quella banda non si disegna, e non compare
 * nessun segnaposto al suo posto.
 */
export function bandStyleOf(slot: CueSlot | null): BandStyle | undefined {
  return slot ? BAND_STYLE[slot.id] : undefined;
}
