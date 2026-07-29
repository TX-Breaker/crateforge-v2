import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { useAppState } from '@/lib/appState';
import { CAMELOT_HUES } from './CamelotWheel';

/**
 * Grafici della panoramica. Nessuna libreria esterna: sono forme semplici, e
 * l'SVG costa meno di un runtime di charting — soprattutto sotto una CSP che
 * vieta qualunque risorsa remota.
 */

/** Numero che sale al valore: 600ms, ease-out, sempre in mono tabellare. */
export function CountUp({
  value,
  className,
  duration = 600
}: {
  value: number;
  className?: string;
  duration?: number;
}) {
  const { locale, motion } = useAppState();
  const [shown, setShown] = useState(value);
  const from = useRef(value);

  useEffect(() => {
    const reduce =
      motion === 'reduce' || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      setShown(value);
      from.current = value;
      return;
    }
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(Math.round(a + (value - a) * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
      else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration, motion]);

  return <span className={cn('tabular-nums', className)}>{shown.toLocaleString(locale)}</span>;
}

/** Anello del punteggio di salute: l'elemento forte della panoramica. */
export function HealthRing({
  score,
  size = 118,
  label
}: {
  score: number;
  size?: number;
  label?: React.ReactNode;
}) {
  const r = size / 2 - 9;
  const c = 2 * Math.PI * r;
  const tone = score >= 85 ? 'text-success' : score >= 60 ? 'text-accent' : 'text-warning';
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          className="stroke-surface-3"
          strokeWidth={7}
          fill="none"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          /* 600ms come il conteggio al centro: due animazioni sullo stesso
             dato devono finire insieme, altrimenti il numero si ferma e
             l'anello continua. */
          className={cn('transition-[stroke-dashoffset] duration-[600ms] ease-out', tone)}
          stroke="currentColor"
          strokeWidth={7}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - Math.max(0, Math.min(100, score)) / 100)}
          fill="none"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={cn('font-mono text-data-xl', tone)}>
          <CountUp value={score} />
        </span>
        {label && <span className="text-caption text-ink-lo">{label}</span>}
      </div>
    </div>
  );
}

/** Istogramma BPM in bucket da 5. */
export function BpmHistogram({
  data,
  className
}: {
  data: { bucket: number; count: number }[];
  className?: string;
}) {
  const { locale } = useAppState();
  const [hover, setHover] = useState<number | null>(null);
  if (data.length === 0) return null;
  const max = Math.max(...data.map((d) => d.count));
  const peak = data.reduce((a, b) => (b.count > a.count ? b : a));

  return (
    <div className={className}>
      <div className="flex h-24 items-end gap-[2px]">
        {data.map((d) => (
          <div
            key={d.bucket}
            className="group relative flex-1"
            onMouseEnter={() => setHover(d.bucket)}
            onMouseLeave={() => setHover((h) => (h === d.bucket ? null : h))}
          >
            {/* Un accento solo per schermata (§1.4): le barre sono neutre e
                l'ambra resta al bucket di picco — e a quello sotto il puntatore,
                che e' l'altra domanda a cui il grafico risponde. */}
            <div
              className={cn(
                'w-full rounded-t-[2px] transition-[height,background-color] duration-swap',
                d.bucket === peak.bucket || hover === d.bucket ? 'bg-accent' : 'bg-line-strong'
              )}
              style={{ height: `${Math.max(2, (d.count / max) * 92)}px` }}
            />
          </div>
        ))}
      </div>
      {/* Sei tacche equidistanti invece dei soli estremi: senza, per leggere
          dove cade una barra si deve contare a occhio. */}
      <div className="mt-1.5 flex justify-between font-mono text-[9.5px] tabular-nums text-ink-lo">
        {axisTicks(data).map((t, i) => (
          <span key={t} className={i === 0 || i === 5 ? '' : 'text-ink-lo/80'}>
            {t}
          </span>
        ))}
      </div>
      <div className="mt-0.5 text-center font-mono text-[9.5px] tabular-nums text-ink-mid">
        {hover !== null
          ? `${hover}–${hover + 5} · ${(data.find((d) => d.bucket === hover)?.count ?? 0).toLocaleString(locale)}`
          : `${peak.bucket}–${peak.bucket + 5} · ${peak.count.toLocaleString(locale)}`}
      </div>
    </div>
  );
}

/** Copertura tonalità: 24 colonne (12A + 12B) nell'ordine della ruota. */
export function KeyCoverage({
  data,
  className
}: {
  data: { camelot: string; count: number }[];
  className?: string;
}) {
  const { locale } = useAppState();
  const map = new Map(data.map((d) => [d.camelot, d.count]));
  const keys: string[] = [];
  for (let n = 1; n <= 12; n++) keys.push(`${n}A`);
  for (let n = 1; n <= 12; n++) keys.push(`${n}B`);
  const max = Math.max(1, ...keys.map((k) => map.get(k) ?? 0));

  /* Griglia 12x2 come il modello, non un istogramma: la domanda qui non e'
     "quanti brani per tonalita'" ma "dove ho buchi nella ruota", e una griglia
     di caselle la risponde a colpo d'occhio. Il riempimento e' la tinta della
     tonalita' miscelata verso il fondo in proporzione al conteggio: casella
     spenta = tonalita' che non hai. */
  return (
    <div className={className}>
      <div className="grid grid-cols-12 gap-[3px]">
        {keys.map((k) => {
          const n = parseInt(k, 10);
          const count = map.get(k) ?? 0;
          const strength = count === 0 ? 0 : 0.25 + (count / max) * 0.75;
          return (
            <div
              key={k}
              title={`${k} · ${count.toLocaleString(locale)}`}
              className="flex aspect-square items-center justify-center rounded-[4px] border border-line-subtle transition-colors duration-swap"
              style={{
                backgroundColor: CAMELOT_HUES[n - 1],
                opacity: count === 0 ? 0.1 : strength
              }}
            >
              <span
                className="font-mono text-[10px] tabular-nums"
                style={{ color: count === 0 ? 'rgb(var(--text-lo))' : 'rgb(var(--canvas))' }}
              >
                {k}
              </span>
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 font-mono text-caption tabular-nums text-ink-lo">
        {data.reduce((s, d) => s + d.count, 0).toLocaleString(locale)}
      </div>
    </div>
  );
}

/**
 * Sei tacche equidistanti sull'asse dei BPM, dalla prima all'ultima colonna.
 * Sei perche' e' il numero che riempie la larghezza senza sovrapporsi alle
 * cifre vicine alle misure tipografiche di questo sistema.
 */
function axisTicks(data: { bucket: number }[]): number[] {
  const first = data[0].bucket;
  const last = data[data.length - 1].bucket + 5;
  const step = (last - first) / 5;
  return Array.from({ length: 6 }, (_, i) => Math.round(first + step * i));
}
