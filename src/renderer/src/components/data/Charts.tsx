import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { useAppState } from '@/lib/appState';
import { aaSafe, mix, readableInk } from '@/lib/colors';
import { tokenHex } from '@/lib/themeTokens';
import { CAMELOT_HUES } from '@/lib/camelotHues';

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
  /* Anello 118 con tratto 9, come il documento: il raggio si ricava dal
     tratto, così cambiando misura l'anello resta proporzionato. */
  const r = size / 2 - 11;
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
          strokeWidth={9}
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
          strokeWidth={9}
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
  className,
  onSelect
}: {
  data: { bucket: number; count: number }[];
  className?: string;
  /** click su una barra: apre l'elenco filtrato su quell'intervallo di tempo */
  onSelect?: (from: number, to: number) => void;
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
          /* La barra è un CONTROLLO, non un disegno: un grafico che mostra 63
             brani fra 70 e 75 BPM e non ti lascia arrivare a quei 63 ti fa
             rifare a mano una selezione che il database ha già in mano. */
          <button
            key={d.bucket}
            type="button"
            disabled={!onSelect || d.count === 0}
            aria-label={`${d.bucket}–${d.bucket + 5} BPM · ${d.count}`}
            onClick={() => onSelect?.(d.bucket, d.bucket + 5)}
            className={cn(
              'group relative flex-1 rounded-t-[2px]',
              onSelect && d.count > 0 ? 'cursor-pointer' : 'cursor-default'
            )}
            onMouseEnter={() => setHover(d.bucket)}
            onMouseLeave={() => setHover((h) => (h === d.bucket ? null : h))}
          >
            {/* Un accento solo per schermata (§1.4): l'ambra sta SOLO sul
                bucket di picco. Il puntatore schiarisce la barra invece di
                accenderla — se anche l'hover fosse in accento, per un istante
                ci sarebbero due picchi e il colore smetterebbe di essere
                informazione. */}
            <div
              className={cn(
                'w-full rounded-t-[2px] transition-[height,background-color] duration-swap',
                d.bucket === peak.bucket
                  ? 'bg-accent'
                  : hover === d.bucket
                    ? 'bg-ink-lo'
                    : 'bg-line-strong'
              )}
              style={{ height: `${Math.max(2, (d.count / max) * 92)}px` }}
            />
          </button>
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
  className,
  onSelect
}: {
  data: { camelot: string; count: number }[];
  className?: string;
  /** click su una barra: apre l'elenco filtrato su quella tonalità */
  onSelect?: (camelot: string) => void;
}) {
  const { locale, themeStyle, isDark } = useAppState();
  const map = new Map(data.map((d) => [d.camelot, d.count]));
  const keys: string[] = [];
  for (let n = 1; n <= 12; n++) keys.push(`${n}A`);
  for (let n = 1; n <= 12; n++) keys.push(`${n}B`);
  const max = Math.max(1, ...keys.map((k) => map.get(k) ?? 0));

  /* Inchiostri del tema attivo: la casella è colorata da un DATO, quindi il
     contrasto della sua etichetta non lo garantisce la palette — va calcolato
     qui, come nella ruota. */
  const inks = useMemo(
    () => ({
      dark: tokenHex('--canvas', '#0A0B0D'),
      light: tokenHex('--text-hi', '#EBECEE'),
      surface: tokenHex('--surface-3', '#1D2126')
    }),
    [themeStyle, isDark]
  );

  /* Barre, una per tonalità, nell'ordine della ruota: 12 minori poi 12
     maggiori. L'altezza dice quanti brani hai, la tinta dice QUALE tonalità —
     sono le stesse dodici della ruota di Camelot, così l'occhio le riconosce
     senza tornare a leggere l'etichetta.
     Ogni tinta passa da `aaSafe` contro il fondo del pannello: le tinte Mixed
     In Key sono sature, e dipinte così come sono sarebbero neon (§07). */
  return (
    <div className={className}>
      <div className="flex h-24 items-end gap-[2px]">
        {keys.map((k) => {
          const n = parseInt(k, 10);
          const count = map.get(k) ?? 0;
          const hue = aaSafe(mix(CAMELOT_HUES[n - 1], inks.dark, 0.86), inks.dark, inks.light);
          return (
            <button
              key={k}
              type="button"
              disabled={!onSelect || count === 0}
              title={`${k} · ${count.toLocaleString(locale)}`}
              aria-label={`${k} · ${count.toLocaleString(locale)}`}
              onClick={() => onSelect?.(k)}
              className={cn(
                'group relative flex-1 rounded-t-[2px] transition-[height,background-color] duration-swap',
                onSelect && count > 0 ? 'cursor-pointer hover:brightness-125' : 'cursor-default'
              )}
              style={{
                height: `${Math.max(2, (count / max) * 92)}px`,
                /* Tonalità che non hai: un moncone neutro, non il vuoto. Uno
                   spazio bianco si legge come "manca il dato"; un moncone
                   spento si legge come "questa tonalità non ce l'hai", che è
                   la risposta vera e il senso di una mappa di copertura. */
                backgroundColor: count === 0 ? inks.surface : hue
              }}
            />
          );
        })}
      </div>
      {/* Le etichette stanno FUORI dalle barre: dentro sparirebbero sui
          monconi bassi, che sono proprio quelli da leggere. */}
      <div className="mt-1.5 flex gap-[2px]">
        {keys.map((k) => (
          <span
            key={k}
            className="flex-1 text-center font-mono text-[8.5px] tabular-nums text-ink-lo"
          >
            {k}
          </span>
        ))}
      </div>
      <div className="mt-1 font-mono text-caption tabular-nums text-ink-lo">
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
