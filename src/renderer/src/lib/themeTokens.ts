/**
 * Lettura dei token del tema ATTIVO dal DOM.
 *
 * Serve ai due componenti che disegnano fuori dal CSS — la ruota di Camelot
 * (SVG con riempimenti calcolati) e la forma d'onda (canvas): loro non possono
 * scrivere `bg-surface-2` e devono chiedere il valore.
 *
 * Chi la usa deve rileggerla QUANDO CAMBIA IL TEMA, non una volta sola: è un
 * valore che cambia sotto i piedi del componente, e memoizzarlo sul dato
 * lasciava la ruota dipinta con la palette precedente.
 */
export function tokenHex(name: string, fallback: string, root?: HTMLElement): string {
  const el = root ?? document.documentElement;
  const raw = getComputedStyle(el).getPropertyValue(name).trim();
  const parts = raw.split(/\s+/).map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return fallback;
  return `#${parts
    .map((n) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0'))
    .join('')}`;
}
