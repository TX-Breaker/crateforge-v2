import { useMemo, useState } from 'react';
import { compatibleKeys, isCompatible, parseCamelot } from '@core/harmony';
import { cn } from '@/lib/utils';

/**
 * Ruota di Camelot (§5.2) — condivisa da Panoramica, Set Builder e Set Planner.
 *
 * Regole del componente:
 *  - anello interno = minore (A), esterno = maggiore (B);
 *  - cliccando un segmento si ri-centra l'insieme di compatibilità;
 *  - la LOGICA ARMONICA NON è reimplementata qui: arriva da core/harmony.ts,
 *    già coperta dai test;
 *  - le tinte seguono la convenzione Mixed In Key che i DJ leggono già, ma è
 *    l'enfasi (non la tinta) a portare la risposta: selezionata e compatibili a
 *    piena forza, tutto il resto scende a un sussurro del proprio colore;
 *  - le etichette sono SEMPRE stampate: la compatibilità non dipende mai dal
 *    solo colore.
 */

/* tinte campionate dalla ruota Mixed In Key, chiave 1 → 12 */
const CAM = [
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
];

const KEYNAME: Record<'A' | 'B', string[]> = {
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

function mix(hex: string, other: string, t: number): string {
  const p = (h: string) => [
    parseInt(h.slice(1, 3), 16),
    parseInt(h.slice(3, 5), 16),
    parseInt(h.slice(5, 7), 16)
  ];
  const a = p(hex);
  const b = p(other);
  return (
    '#' +
    a
      .map((v, i) => Math.round(v * t + b[i] * (1 - t)).toString(16).padStart(2, '0'))
      .join('')
  );
}

function luminance(hex: string): number {
  const ch = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

function ratio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * Alcune mescolanze finiscono in una fascia di luminanza morta dove nessuno dei
 * due inchiostri passa AA: si scurisce il riempimento finché uno dei due ce la
 * fa. Serve in circa il 10% degli stati della ruota.
 */
function aaSafe(bg: string, dark: string, light: string): string {
  let c = bg;
  for (let i = 0; i < 24; i++) {
    if (Math.max(ratio(dark, c), ratio(light, c)) >= 4.6) break;
    c = mix(c, dark, 0.9);
  }
  return c;
}

export function CamelotWheel({
  value,
  onChange,
  /** 'compatible' spegne le tonalità non compatibili, 'all' le tiene leggibili */
  emphasis = 'compatible',
  size = 300,
  className
}: {
  value: string | null;
  onChange?: (camelot: string) => void;
  emphasis?: 'compatible' | 'all';
  size?: number;
  className?: string;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const sel = parseCamelot(value) ?? { num: 8, letter: 'A' as const };

  // Inchiostri presi dal tema attivo, così la ruota resta AA in tutte le palette.
  const inks = useMemo(() => {
    const css = getComputedStyle(document.documentElement);
    const rgb = (name: string, fallback: string) => {
      const raw = css.getPropertyValue(name).trim();
      const p = raw.split(/\s+/).map(Number);
      if (p.length !== 3 || p.some((n) => !Number.isFinite(n))) return fallback;
      return `#${p.map((n) => n.toString(16).padStart(2, '0')).join('')}`;
    };
    return {
      dark: rgb('--canvas', '#0A0B0D'),
      light: rgb('--text-hi', '#EBECEE'),
      panel: rgb('--surface-1', '#101215'),
      line: rgb('--line', '#2C3138'),
      muted: rgb('--text-lo', '#6E757E'),
      mid: rgb('--text-mid', '#A2A8B0')
    };
  }, [value, emphasis]);

  const cx = 150;
  const cy = 150;

  const arc = (r0: number, r1: number, a0: number, a1: number) => {
    const p = (r: number, a: number) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
    const [x0, y0] = p(r1, a0);
    const [x1, y1] = p(r1, a1);
    const [x2, y2] = p(r0, a1);
    const [x3, y3] = p(r0, a0);
    return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${r1} ${r1} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}L${x2.toFixed(2)} ${y2.toFixed(2)}A${r0} ${r0} 0 0 0 ${x3.toFixed(2)} ${y3.toFixed(2)}Z`;
  };

  const segments: React.ReactNode[] = [];
  const labels: React.ReactNode[] = [];

  ([
    ['A', 56, 96],
    ['B', 100, 140]
  ] as const).forEach(([ring, r0, r1]) => {
    for (let n = 1; n <= 12; n++) {
      const id = `${n}${ring}`;
      const a0 = ((n * 30 - 105) * Math.PI) / 180;
      const a1 = ((n * 30 - 75) * Math.PI) / 180;
      const am = ((n * 30 - 90) * Math.PI) / 180;

      const self = n === sel.num && ring === sel.letter;
      const compat = isCompatible(sel, { num: n, letter: ring });
      const strength = self ? 1 : compat ? 0.5 : emphasis === 'all' ? 0.34 : 0.13;
      const isHover = hover === id;
      const t = isHover ? Math.min(1, strength + 0.26) : strength;
      const off = isHover ? 5 : 0;

      // L'anello minore è una tinta più chiara della stessa tonalità.
      const hue = ring === 'A' ? mix(CAM[n - 1], '#FFFFFF', 0.74) : CAM[n - 1];
      const fill = aaSafe(mix(hue, inks.dark, t), inks.dark, inks.light);
      const ink = ratio(inks.dark, fill) >= ratio(inks.light, fill) ? inks.dark : inks.light;

      segments.push(
        <path
          key={id}
          d={arc(r0, r1, a0, a1)}
          fill={fill}
          stroke={self ? inks.light : inks.dark}
          strokeWidth={2}
          tabIndex={0}
          role="radio"
          aria-checked={self}
          aria-label={`${id} · ${KEYNAME[ring][n - 1]}`}
          onMouseEnter={() => setHover(id)}
          onMouseLeave={() => setHover((h) => (h === id ? null : h))}
          onFocus={() => setHover(id)}
          onBlur={() => setHover((h) => (h === id ? null : h))}
          onClick={() => onChange?.(id)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onChange?.(id);
            }
          }}
          style={{
            cursor: onChange ? 'pointer' : 'default',
            transition: 'fill 150ms ease-out, transform 180ms cubic-bezier(.2,0,0,1)',
            transform: `translate(${(off * Math.cos(am)).toFixed(2)}px, ${(off * Math.sin(am)).toFixed(2)}px)`
          }}
        />
      );

      const rm = (r0 + r1) / 2;
      labels.push(
        <text
          key={`t${id}`}
          x={cx + (rm + off) * Math.cos(am)}
          y={cy + (rm + off) * Math.sin(am) + 4}
          textAnchor="middle"
          fill={ink}
          pointerEvents="none"
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: self ? 12 : 11,
            fontWeight: self ? 700 : 500,
            transition: 'fill 150ms ease-out'
          }}
        >
          {id}
        </text>
      );
    }
  });

  const shown = hover ?? `${sel.num}${sel.letter}`;
  const shownPos = parseCamelot(shown)!;
  const compatList = compatibleKeys(sel)
    .map((p) => `${p.num}${p.letter}`)
    .join(' · ');

  return (
    <div className={cn('flex flex-col items-center', className)}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 300 300"
        role="radiogroup"
        aria-label="Camelot"
      >
        <circle cx={cx} cy={cy} r={52} fill={inks.panel} stroke={inks.line} />
        {segments}
        {labels}
        <text
          x={cx}
          y={cy - 14}
          textAnchor="middle"
          fill={inks.muted}
          style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 8.5, letterSpacing: '.14em' }}
        >
          {hover ? 'HOVER' : 'SELECTED'}
        </text>
        <text
          x={cx}
          y={cy + 10}
          textAnchor="middle"
          fill={CAM[shownPos.num - 1]}
          style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 22, fontWeight: 700 }}
        >
          {shown}
        </text>
        <text
          x={cx}
          y={cy + 26}
          textAnchor="middle"
          fill={inks.mid}
          style={{ fontFamily: 'Archivo, sans-serif', fontSize: 9.5 }}
        >
          {KEYNAME[shownPos.letter][shownPos.num - 1]}
        </text>
      </svg>
      <div className="mt-3 text-center">
        <div className="font-mono text-eyebrow uppercase text-ink-lo">
          {compatList}
        </div>
      </div>
    </div>
  );
}

export { CAM as CAMELOT_HUES, KEYNAME as CAMELOT_KEYNAMES };
