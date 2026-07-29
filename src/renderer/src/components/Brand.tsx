import { cn } from '@/lib/utils';

/**
 * Marchio CrateForge — "The Crate" (specifica logo §01–§07).
 *
 * Un contenitore aperto in alto che regge tre dorsi di disco, quello centrale
 * ambra: è l'oggetto da cui il prodotto prende il nome, e il dorso ambra è
 * quello su cui stai lavorando. Aperto perché il programma legge la tua
 * libreria e te la restituisce, non ci si chiude sopra.
 *
 * QUATTRO DISEGNI, NON UNO SCALATO (§03). Sotto i 32px il tratto si ingrossa
 * contro la cornice e il dettaglio viene tolto un passo alla volta: a 16px il
 * terzo dorso sparisce, perché tre dorsi a quella misura diventano un blocco
 * grigio. Scalare l'unico disegno grande farebbe cadere i tratti sotto il pixel
 * fisico e i tre dorsi si fonderebbero.
 *
 * IL COLORE VIENE DAI TOKEN, non da esadecimali fissi: così il marchio segue il
 * tema scelto dall'utente (Studio, Neutro, OLED, chiaro o scuro) invece di
 * portarsi dietro il proprio arancione. Le cinque rese permesse dalla specifica
 * §04 sono le cinque `tone` qui sotto, e nessuna altra.
 */

interface Drawing {
  /** spessore del tratto della cornice */
  s: number;
  /** path della cornice */
  f: string;
  /** dorsi: x, y, larghezza, altezza */
  r: [number, number, number, number][];
  /** raggio dei dorsi */
  rx: number;
}

const D: Record<'a' | 'b' | 'c' | 'd', Drawing> = {
  // A · 48px e oltre — geometria piena, l'unico ammesso senza piastrella
  a: {
    s: 6,
    f: 'M10 13V45a6 6 0 0 0 6 6h32a6 6 0 0 0 6-6V13',
    r: [
      [18.5, 26, 7, 22],
      [28.5, 20, 7, 28],
      [38.5, 30, 7, 18]
    ],
    rx: 1.5
  },
  // B · 32px — mezzo punto di tratto in più per tenere il peso contro l'ambra
  b: {
    s: 6.5,
    f: 'M10 13V45a6 6 0 0 0 6 6h32a6 6 0 0 0 6-6V13',
    r: [
      [18.5, 26, 7, 22],
      [28.5, 20, 7, 28],
      [38.5, 30, 7, 18]
    ],
    rx: 1.5
  },
  // C · 20–24px — cornice più stretta, dorsi larghi e senza raggio: la sidebar
  c: {
    s: 7,
    f: 'M10 13V45a6 6 0 0 0 6 6h32a6 6 0 0 0 6-6V13',
    r: [
      [18.5, 27, 7, 21],
      [28.5, 21, 7, 27],
      [38.5, 31, 7, 17]
    ],
    rx: 1
  },
  // D · 16–18px — due dorsi: bastano a dire "contenuto", tre sarebbero fanghiglia
  d: {
    s: 9,
    f: 'M12 14V44a6 6 0 0 0 6 6h28a6 6 0 0 0 6-6V14',
    r: [
      [22, 28, 8, 18],
      [34, 23, 8, 23]
    ],
    rx: 1
  }
};

const pick = (px: number): Drawing => (px >= 40 ? D.a : px >= 28 ? D.b : px >= 20 ? D.c : D.d);

/**
 * Le cinque rese permesse (§04):
 *  - `brand`      Primary · dark e Primary · light insieme: i token cambiano da
 *                 soli con il tema, quindi una sola resa copre entrambe.
 *  - `knockout`   Knockout on accent: sopra la piastrella ambra o qualunque
 *                 campo accento, tutto in inchiostro dell'accento.
 *  - `mono`       One ink: un solo inchiostro, eredita `currentColor`. Stampa a
 *                 lastra singola, incisione, contesti senza colore.
 *  - `watermark`  Disabled · watermark: filigrana spenta, MAI con l'accento —
 *                 l'ambra significa "questa è la selezione", e una filigrana non
 *                 seleziona niente.
 */
export type BrandTone = 'brand' | 'knockout' | 'mono' | 'watermark';

export function CrateMark({
  size = 22,
  tone = 'brand',
  className
}: {
  size?: number;
  tone?: BrandTone;
  className?: string;
}) {
  const d = pick(size);

  const frame =
    tone === 'knockout'
      ? 'stroke-accent-ink'
      : tone === 'mono'
        ? 'stroke-current'
        : tone === 'watermark'
          ? 'stroke-ink-disabled'
          : 'stroke-ink-hi';

  const dim =
    tone === 'knockout'
      ? 'fill-accent-ink'
      : tone === 'mono'
        ? 'fill-current'
        : tone === 'watermark'
          ? 'fill-line-strong'
          : 'fill-ink-lo';

  // Un solo elemento ambra, una volta sola: l'accento marca la selezione, lo
  // stesso mestiere che fa in tutta l'interfaccia.
  const hot = tone === 'brand' ? 'fill-accent' : dim;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      role="img"
      aria-label="CrateForge"
      className={className}
    >
      <path d={d.f} strokeWidth={d.s} strokeLinecap="square" className={frame} />
      {d.r.map(([x, y, w, h], i) => (
        <rect
          key={i}
          x={x}
          y={y}
          width={w}
          height={h}
          rx={d.rx}
          // Il dorso ambra è il centrale nel disegno a tre; nel disegno a due
          // (16px) è il secondo, che lì è quello più alto.
          className={i === 1 ? hot : dim}
        />
      ))}
    </svg>
  );
}

/**
 * Piastrella ambra con il marchio in negativo: è il blocco che compare nella
 * barra del titolo e in testa alla colonna di navigazione. Il raggio è quello
 * dello slot che occupa, non quello del logo — la specifica §05 chiede lo
 * stesso box, stesso raggio, stessa posizione di prima, così lo scambio non
 * muove il layout.
 */
export function CrateTile({
  size,
  radius,
  className
}: {
  size: number;
  radius: number;
  className?: string;
}) {
  return (
    <span
      className={cn('grid shrink-0 place-items-center bg-accent', className)}
      style={{ width: size, height: size, borderRadius: radius }}
    >
      <CrateMark size={Math.round(size * 0.72)} tone="knockout" />
    </span>
  );
}

/**
 * Lockup orizzontale (W1 · Primary — Tight, §02): marchio più nome.
 *
 * Il nome è in Be Vietnam Pro 600 con tracciatura -0.035em, come chiede la
 * specifica per il peso del lockup:
 * è la voce dell'interfaccia. La targa mono resta al lockup tecnico (W3), che
 * è un'altra cosa e serve altrove.
 */
export function CrateLockup({
  size = 22,
  radius = 5,
  tile = true,
  descriptor,
  className
}: {
  size?: number;
  radius?: number;
  /** false nei punti dove la specifica vuole il marchio nudo (pannello Info) */
  tile?: boolean;
  descriptor?: string;
  className?: string;
}) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      {tile ? <CrateTile size={size} radius={radius} /> : <CrateMark size={size} />}
      <span className="flex flex-col leading-none">
        <span className="text-body font-semibold tracking-[-.035em] text-ink-hi">CrateForge</span>
        {descriptor && (
          <span className="mt-1 text-caption text-ink-lo">{descriptor}</span>
        )}
      </span>
    </span>
  );
}

/**
 * Lockup tecnico impilato (W3 · Equipment, §02): marchio sopra, nome in mono
 * maiuscolo con tracciatura +0.22em, riga di versione facoltativa. È la voce
 * della targa: schermata iniziale, pannello Info, rapporti di errore.
 */
export function CrateStack({
  size = 48,
  version,
  className
}: {
  size?: number;
  version?: string;
  className?: string;
}) {
  return (
    <span className={cn('inline-flex flex-col items-center', className)}>
      <CrateMark size={size} />
      <span
        className="mt-3 font-mono font-medium uppercase text-ink-hi"
        style={{ letterSpacing: '0.22em', fontSize: Math.max(11, Math.round(size * 0.26)) }}
      >
        CrateForge
      </span>
      {version && (
        <span className="mt-1 font-mono text-caption tracking-[.14em] text-ink-lo">{version}</span>
      )}
    </span>
  );
}

/**
 * Filigrana (§04 · Disabled · watermark). Sta dietro agli stati vuoti: dice di
 * chi è la finestra senza competere con il testo che spiega cosa fare. Mai con
 * l'accento, e mai cliccabile.
 */
export function CrateWatermark({ size = 96, className }: { size?: number; className?: string }) {
  return (
    <CrateMark
      size={size}
      tone="watermark"
      className={cn('pointer-events-none select-none opacity-45', className)}
    />
  );
}
