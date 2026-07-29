import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Conformità al design system (§8.4).
 *
 * Due regole del documento falliscono IN SILENZIO: non producono un errore,
 * non cambiano il layout, e nessuna schermata le rivela. Sono queste due, e
 * per questo hanno un test invece di una revisione a occhio:
 *
 *  1. il rispetto di `prefers-reduced-motion` deve arrivare al livello JS —
 *     la regola CSS non tocca le animazioni di framer-motion, che continuano
 *     a muoversi per chi ha chiesto di non far muovere niente;
 *  2. nessun colore di cue può cadere fuori dagli otto esadecimali dichiarati —
 *     un colore fuori palette si vede solo se qualcuno apre quel brano, su quel
 *     tema, e si ricorda a memoria la tinta giusta.
 */

const ROOT = join(__dirname, '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf-8');

/** Gli otto slot dichiarati in §5.1 / §8.1, in ordine. */
const CUE_HEXES = [
  '#6C9BC9',
  '#5E9E72',
  '#E8912E',
  '#8F8AC4',
  '#C4776B',
  '#7FA8A0',
  '#C4768F',
  '#8F9A5E'
];

describe('§8.4 — movimento ridotto fino al livello JS', () => {
  it('App avvolge la shell in MotionConfig legato alla preferenza', () => {
    const app = read('src/renderer/src/App.tsx');
    expect(app).toContain('MotionConfig');
    // Deve leggere la preferenza dell'utente, non un valore fisso.
    expect(app).toMatch(/reducedMotion=\{[^}]*'always'[^}]*'user'[^}]*\}/);
  });

  it('la regola CSS resta, ma non è più l’unica difesa', () => {
    const css = read('src/renderer/src/index.css');
    expect(css).toContain('prefers-reduced-motion');
    expect(css).toContain("data-motion='reduce'");
  });
});

describe('§8.1 — nessun colore di cue fuori dagli otto dichiarati', () => {
  it('la palette del renderer contiene esattamente gli otto slot, in ordine', () => {
    const src = read('src/renderer/src/lib/cuePalette.ts');
    const block = src.slice(src.indexOf('CUE_PALETTE'), src.indexOf('] as const'));
    const hexes = (block.match(/#[0-9A-Fa-f]{6}/g) ?? []).map((h) => h.toUpperCase());
    expect(hexes).toEqual(CUE_HEXES);
    const slots = (block.match(/slot:\s*(\d)/g) ?? []).map((m) => Number(m.split(':')[1]));
    expect(slots).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('i colori Tailwind dei cue sono gli stessi otto', () => {
    const cfg = read('tailwind.config.js');
    const block = cfg.slice(cfg.indexOf('cue: {'), cfg.indexOf('}', cfg.indexOf('cue: {')));
    const found = block.match(/#[0-9A-Fa-f]{6}/g) ?? [];
    expect(found.map((h) => h.toUpperCase())).toEqual(CUE_HEXES);
  });

  it('il sidecar propone i cue SOLO con i colori dichiarati', () => {
    const py = read('python-sidecar/sidecar.py');
    /* `add("Etichetta", posizione, "#RRGGBB")` è l'unico punto in cui
       l'analizzatore assegna un colore a un cue proposto. */
    const calls = [...py.matchAll(/add\(\s*"[^"]+"\s*,[^,]+,\s*"(#[0-9A-Fa-f]{6})"\s*\)/g)].map(
      (m) => m[1].toUpperCase()
    );
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      expect(CUE_HEXES, `colore fuori palette nel sidecar: ${c}`).toContain(c);
    }
    // I due colori sopra la soglia neon che il documento rifiuta per nome.
    expect(py).not.toContain('#28e214');
    expect(py).not.toContain('#e21414');
  });
});
