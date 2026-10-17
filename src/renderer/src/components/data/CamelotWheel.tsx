import { useMemo, useState } from 'react';
import { compatibleKeys, isCompatible, parseCamelot } from '@core/harmony';
import { cn } from '@/lib/utils';
import { useAppState } from '@/lib/appState';
import { useT } from '@/lib/strings';
import { aaSafe, ensureReadable, mix, readableInk } from '@/lib/colors';
import { tokenHex } from '@/lib/themeTokens';
import { CAMELOT_HUES as CAM, CAMELOT_KEYNAMES as KEYNAME } from '@/lib/camelotHues';

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
  const { themeStyle, isDark } = useAppState();
  const t = useT();
  const sel = parseCamelot(value) ?? { num: 8, letter: 'A' as const };

  /* Inchiostri presi dal tema ATTIVO, così la ruota resta AA in tutte le
     palette. Le dipendenze sono il tema, non il dato: legate a `value` la
     memoizzazione teneva i colori della palette precedente finché non si
     cliccava un segmento — e su Studio Light significava testo quasi bianco
     su fondo chiaro. */
  const inks = useMemo(
    () => ({
      dark: tokenHex('--canvas', '#0A0B0D'),
      light: tokenHex('--text-hi', '#EBECEE'),
      panel: tokenHex('--surface-1', '#101215'),
      line: tokenHex('--line', '#2C3138'),
      muted: tokenHex('--text-lo', '#6E757E'),
      mid: tokenHex('--text-mid', '#A2A8B0')
    }),
    [themeStyle, isDark]
  );

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
  /* Zone di puntamento FISSE, sopra il disegno.

     ⚠ La casella sotto il puntatore si sposta di qualche pixel verso
     l'esterno. Se fosse lei a ricevere gli eventi, sul suo bordo il puntatore
     ne uscirebbe, lei tornerebbe al suo posto, il puntatore ci rientrerebbe:
     uno sfarfallio continuo fra «puntatore» e «selezionata». Le zone qui non
     si muovono mai e sono contigue — anche sopra le fessure fra due caselle e
     fra i due anelli — così il puntatore è sempre esattamente su una tonalità. */
  const hits: React.ReactNode[] = [];

  (
    [
      ['A', 56, 96, 56, 98],
      ['B', 100, 140, 98, 144]
    ] as const
  ).forEach(([ring, r0, r1, h0, h1]) => {
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
      const ink = readableInk(fill, inks.dark, inks.light);

      segments.push(
        <path
          key={id}
          d={arc(r0, r1, a0, a1)}
          fill={fill}
          stroke={self ? inks.light : inks.dark}
          strokeWidth={2}
          pointerEvents="none"
          style={{
            transition: 'fill 150ms ease-out, transform 180ms cubic-bezier(.2,0,0,1)',
            transform: `translate(${(off * Math.cos(am)).toFixed(2)}px, ${(off * Math.sin(am)).toFixed(2)}px)`
          }}
        />
      );

      hits.push(
        <path
          key={`h${id}`}
          d={arc(h0, h1, a0, a1)}
          fill="transparent"
          tabIndex={0}
          role="radio"
          aria-checked={self}
          aria-label={`${id} · ${KEYNAME[ring][n - 1]}`}
          onPointerEnter={() => setHover(id)}
          onPointerLeave={() => setHover((h) => (h === id ? null : h))}
          onFocus={() => setHover(id)}
          onBlur={() => setHover((h) => (h === id ? null : h))}
          onClick={() => onChange?.(id)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onChange?.(id);
            }
          }}
          style={{ cursor: onChange ? 'pointer' : 'default', outline: 'none' }}
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
      <svg width={size} height={size} viewBox="0 0 300 300" role="radiogroup" aria-label="Camelot">
        <circle cx={cx} cy={cy} r={52} fill={inks.panel} stroke={inks.line} />
        {segments}
        {labels}
        {hits}
        <text
          x={cx}
          y={cy - 14}
          textAnchor="middle"
          fill={inks.muted}
          style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 8.5, letterSpacing: '.14em' }}
        >
          {(hover ? t('wheel.hover') : t('wheel.selected')).toUpperCase()}
        </text>
        {/* La tonalità al centro è scritta nella SUA tinta, ma portata sopra
            4.5:1 contro il pannello: sulle palette chiare un ciano acceso su
            carta non si legge, e il numero è l'informazione principale della
            ruota. */}
        <text
          x={cx}
          y={cy + 10}
          textAnchor="middle"
          fill={ensureReadable(CAM[shownPos.num - 1], inks.panel, inks.dark, inks.light)}
          style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 22, fontWeight: 700 }}
        >
          {shown}
        </text>
        <text
          x={cx}
          y={cy + 26}
          textAnchor="middle"
          fill={inks.mid}
          style={{ fontFamily: "'Be Vietnam Pro', sans-serif", fontSize: 9.5 }}
        >
          {KEYNAME[shownPos.letter][shownPos.num - 1]}
        </text>
      </svg>
      <div className="mt-3 text-center">
        <div className="font-mono text-eyebrow uppercase text-ink-lo">{compatList}</div>
      </div>
    </div>
  );
}
