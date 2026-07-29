/**
 * Analisi armonica sulla ruota di Camelot (§6 Fase 3.2, Set Planner).
 * Regola classica del mixing in key: da NL (numero+lettera) sono compatibili
 * NL stesso, N±1 stessa lettera, N con lettera opposta.
 */

export interface CamelotPos {
  num: number; // 1..12
  letter: 'A' | 'B';
}

export function parseCamelot(c: string | null | undefined): CamelotPos | null {
  if (!c) return null;
  const m = c.trim().match(/^([1-9]|1[0-2])([AB])$/i);
  if (!m) return null;
  return { num: Number(m[1]), letter: m[2].toUpperCase() as 'A' | 'B' };
}

/** Distanza minima sull'anello dei numeri (1 e 12 sono adiacenti). */
function ringDistance(a: number, b: number): number {
  const d = Math.abs(a - b);
  return Math.min(d, 12 - d);
}

/**
 * Compatibilità armonica secondo la regola Camelot standard.
 * true anche per la coppia stessa-tonalità.
 */
export function isCompatible(a: CamelotPos, b: CamelotPos): boolean {
  if (a.letter === b.letter) return ringDistance(a.num, b.num) <= 1;
  return a.num === b.num;
}

/** Lista delle posizioni compatibili con una data (se stessa inclusa). */
export function compatibleKeys(p: CamelotPos): CamelotPos[] {
  const prev = ((p.num + 10) % 12) + 1;
  const next = (p.num % 12) + 1;
  return [
    p,
    { num: prev, letter: p.letter },
    { num: next, letter: p.letter },
    { num: p.num, letter: p.letter === 'A' ? 'B' : 'A' }
  ];
}

export function camelotToString(p: CamelotPos): string {
  return `${p.num}${p.letter}`;
}

/** Variazione BPM percentuale (assoluta) tra due tempi. */
export function bpmDeltaPct(a: number, b: number): number {
  if (a <= 0) return Infinity;
  return Math.abs((b - a) / a) * 100;
}

export type TransitionFlag = 'key-clash' | 'bpm-jump' | 'missing-key' | 'missing-bpm';

export interface TransitionCheck {
  flags: TransitionFlag[];
  keyOk: boolean | null; // null = dato mancante
  bpmDelta: number | null; // percentuale, null = dato mancante
}

/** Soglia oltre la quale il salto BPM è segnalato (sync/pitch oltre ~6% si sente). */
export const BPM_JUMP_THRESHOLD_PCT = 6;

export function checkTransition(
  fromCamelot: string | null,
  fromBpm: number | null | undefined,
  toCamelot: string | null,
  toBpm: number | null | undefined
): TransitionCheck {
  const flags: TransitionFlag[] = [];
  const a = parseCamelot(fromCamelot);
  const b = parseCamelot(toCamelot);
  let keyOk: boolean | null = null;
  if (!a || !b) {
    flags.push('missing-key');
  } else {
    keyOk = isCompatible(a, b);
    if (!keyOk) flags.push('key-clash');
  }
  let bpmDelta: number | null = null;
  // Check laschi: ai confini IPC i campi opzionali arrivano undefined, non null,
  // e un NaN passerebbe i confronti con < scivolando via senza flag.
  if (!Number.isFinite(fromBpm as number) || !Number.isFinite(toBpm as number) || (fromBpm as number) <= 0 || (toBpm as number) <= 0) {
    flags.push('missing-bpm');
  } else {
    bpmDelta = bpmDeltaPct(fromBpm as number, toBpm as number);
    if (bpmDelta > BPM_JUMP_THRESHOLD_PCT) flags.push('bpm-jump');
  }
  return { flags, keyOk, bpmDelta };
}
