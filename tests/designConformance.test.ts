import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  BAND_STYLE,
  CUE_HEXES,
  CUE_PALETTE,
  bandStyleOf,
  cueColor,
  isDeclaredCueColor,
  slotFromLabel
} from '../src/renderer/src/lib/cuePalette';
import { CAMELOT_HUES } from '../src/renderer/src/lib/camelotHues';
import { aaSafe, contrastRatio, ensureReadable, mix, readableInk } from '../src/renderer/src/lib/colors';

/**
 * Conformità al design system (§8.4).
 *
 * Alcune regole del documento falliscono IN SILENZIO: non producono un errore,
 * non cambiano il layout, e nessuna schermata le rivela. Per quelle serve un
 * test invece di una revisione a occhio.
 *
 * Nota su cosa viene provato QUI: le regole che sono funzioni pure vengono
 * ESEGUITE, non cercate nel sorgente. Un test che fa grep sul codice dimostra
 * solo che il file è scritto come previsto — non che l'applicazione si comporti
 * come previsto, che è l'unica cosa che interessa all'utente. Restano letture
 * di sorgente le due cose che da qui non si possono eseguire: il sidecar (è
 * Python) e il montaggio della shell React (l'ambiente dei test è node).
 */

const ROOT = join(__dirname, '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf-8');

/** Gli otto slot dichiarati in §5.1 / §8.1, in ordine. */
const DECLARED = [
  '#6C9BC9',
  '#5E9E72',
  '#E8912E',
  '#8F8AC4',
  '#C4776B',
  '#7FA8A0',
  '#C4768F',
  '#8F9A5E'
];

/* I due colori sopra la soglia neon che §8.1 rifiuta per nome, più le tinte
   con cui Serato e Rekordbox marcano davvero i cue nei file dell'utente. */
const FOREIGN = ['#28E214', '#E21414', '#00FF00', '#FF0000', '#0000FF'];

describe('§8.1 — la palette dei cue è dichiarata E applicata', () => {
  it('contiene esattamente gli otto slot, nell’ordine dichiarato', () => {
    expect(CUE_PALETTE.map((c) => c.hex)).toEqual(DECLARED);
    expect(CUE_PALETTE.map((c) => c.slot)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(CUE_HEXES).toEqual(DECLARED);
  });

  it('un colore estraneo non passa mai al disegno', () => {
    /* È il caso vero: un cue importato da una libreria altrui si porta dietro
       la sua tinta. Dichiarare la palette e poi disegnare quella tinta
       significa non averla dichiarata. */
    for (const hex of FOREIGN) {
      expect(isDeclaredCueColor(hex)).toBe(false);
      const out = cueColor({ label: 'Hot Cue A', color: hex });
      expect(out).toBeNull();
    }
  });

  it('l’etichetta vince sul colore del file', () => {
    expect(cueColor({ label: 'Drop', color: '#28E214' })).toBe('#E8912E');
    expect(cueColor({ label: 'second drop', color: null })).toBe('#C4776B');
    expect(cueColor({ label: 'DROP 2', color: undefined })).toBe('#C4776B');
    expect(cueColor({ label: 'vocal', color: '#FF0000' })).toBe('#C4768F');
  });

  it('un colore già dichiarato viene tenuto anche senza etichetta nota', () => {
    expect(cueColor({ label: 'Cue 3', color: '#8f9a5e' })).toBe('#8F9A5E');
    expect(cueColor({ label: null, color: null })).toBeNull();
  });

  it('nessun colore prodotto cade fuori dagli otto, per nessun ingresso', () => {
    const labels = [...CUE_PALETTE.map((c) => c.label), 'Cue 1', '', 'Drop 2', 'boh', null];
    const colors = [...DECLARED, ...FOREIGN, null, undefined, 'non-un-colore'];
    for (const label of labels) {
      for (const color of colors) {
        const out = cueColor({ label, color });
        if (out !== null) expect(DECLARED).toContain(out);
      }
    }
  });
});

describe('§8.1 — bande di struttura', () => {
  it('riempimento .05, e .07 SOLO sui due drop', () => {
    for (const [id, style] of Object.entries(BAND_STYLE)) {
      const isDrop = id === 'drop' || id === 'drop2';
      expect(style.fillOpacity, id).toBeCloseTo(isDrop ? 0.07 : 0.05, 5);
      expect(style.label, id).toBe(isDrop ? 'accent' : 'muted');
    }
  });

  it('solo le sei sezioni hanno una banda: vocal, loop e ignoto non ne hanno', () => {
    /* Stessa composizione che fa la forma d'onda: etichetta → slot → stile. */
    const bandOf = (label: string | null) => bandStyleOf(slotFromLabel(label));
    expect(bandOf('Intro')?.fill).toBe('#6C9BC9');
    expect(bandOf('Second drop')?.label).toBe('accent');
    expect(bandOf('Vocal')).toBeUndefined();
    expect(bandOf('Loop')).toBeUndefined();
    expect(bandOf('sezione che non esiste')).toBeUndefined();
    expect(bandOf(null)).toBeUndefined();
  });
});

describe('§07 — le tinte-dato restano leggibili in tutte le palette', () => {
  /* canvas (`dark`), text-hi (`light`) e surface-1 (`panel`) delle cinque
     palette di index.css. I nomi dei due inchiostri sono quelli del codice: su
     una palette chiara "dark" è il canvas chiaro, ed è proprio il caso in cui
     il calcolo deve andare nella direzione opposta. */
  const THEMES = [
    { name: 'studio dark', dark: '#0a0b0d', light: '#ebecee', panel: '#101215' },
    { name: 'studio light', dark: '#f1efeb', light: '#1a1b1d', panel: '#edeae4' },
    { name: 'neutral dark', dark: '#0e0f11', light: '#ecedef', panel: '#141619' },
    { name: 'neutral light', dark: '#f7f7f8', light: '#17181a', panel: '#f1f2f3' },
    { name: 'oled', dark: '#000000', light: '#e9eaed', panel: '#090a0b' }
  ];

  it('ogni tonalità della ruota passa 4.5:1 con l’inchiostro che le tocca', () => {
    for (const th of THEMES) {
      for (const base of CAMELOT_HUES) {
        // anello esterno (B) e anello interno (A, la stessa tinta schiarita)
        for (const hue of [base, mix(base, '#FFFFFF', 0.74)]) {
          for (const strength of [0.13, 0.3, 0.34, 0.5, 0.76, 1]) {
            const fill = aaSafe(mix(hue, th.dark, strength), th.dark, th.light);
            const ink = readableInk(fill, th.dark, th.light);
            expect(
              contrastRatio(ink, fill),
              `${th.name} · ${hue} · forza ${strength}`
            ).toBeGreaterThanOrEqual(4.5);
          }
        }
      }
    }
  });

  it('la tonalità scritta al centro della ruota si legge sul pannello', () => {
    for (const th of THEMES) {
      for (const hue of CAMELOT_HUES) {
        const c = ensureReadable(hue, th.panel, th.dark, th.light);
        expect(contrastRatio(c, th.panel), `${th.name} · ${hue}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});

describe('§8.4 — movimento ridotto fino al livello JS', () => {
  /* Qui il grep È la prova migliore disponibile: montare la shell React
     richiederebbe un DOM, e l'ambiente dei test è node. */
  it('App avvolge la shell in MotionConfig legato alla preferenza', () => {
    const app = read('src/renderer/src/App.tsx');
    expect(app).toContain('MotionConfig');
    expect(app).toMatch(/reducedMotion=\{[^}]*'always'[^}]*'user'[^}]*\}/);
  });

  it('la regola CSS resta, ma non è più l’unica difesa', () => {
    const css = read('src/renderer/src/index.css');
    expect(css).toContain('prefers-reduced-motion');
    expect(css).toContain("data-motion='reduce'");
  });
});

describe('§8.1 — il sidecar propone i cue solo con i colori dichiarati', () => {
  it('nessun colore fuori palette in sidecar.py', () => {
    const py = read('python-sidecar/sidecar.py');
    /* `add("Etichetta", posizione, "#RRGGBB")` è l'unico punto in cui
       l'analizzatore assegna un colore a un cue proposto. */
    const calls = [...py.matchAll(/add\(\s*"[^"]+"\s*,[^,]+,\s*"(#[0-9A-Fa-f]{6})"\s*\)/g)].map(
      (m) => m[1].toUpperCase()
    );
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      expect(DECLARED, `colore fuori palette nel sidecar: ${c}`).toContain(c);
    }
    expect(py).not.toContain('#28e214');
    expect(py).not.toContain('#e21414');
  });

  it('i colori Tailwind dei cue sono gli stessi otto', () => {
    const cfg = read('tailwind.config.js');
    const block = cfg.slice(cfg.indexOf('cue: {'), cfg.indexOf('}', cfg.indexOf('cue: {')));
    const found = block.match(/#[0-9A-Fa-f]{6}/g) ?? [];
    expect(found.map((h) => h.toUpperCase())).toEqual(DECLARED);
  });
});

describe('§8.3 — ogni stato vuoto ha un’uscita', () => {
  /* La regola ora è nel tipo (`action` obbligatoria), quindi la difesa vera è
     il compilatore. Questo test tiene il punto anche per chi legge il diff:
     se qualcuno rendesse di nuovo facoltativa la prop, fallisce qui prima che
     in revisione. */
  it('EmptyState dichiara `action` come obbligatoria', () => {
    const src = read('src/renderer/src/components/ui/misc.tsx');
    const block = src.slice(src.indexOf('export function EmptyState'));
    expect(block).toMatch(/\n\s*action: React\.ReactNode;/);
    expect(block).not.toMatch(/\n\s*action\?: React\.ReactNode;/);
  });
});
