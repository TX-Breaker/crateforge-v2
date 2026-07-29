import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Superfici (§1.1). Card = surface.2 su canvas, bordo sottile, raggio 10.
 * Nessuna ombra pesante: la profondità viene dalla stratificazione, non dal blur.
 */
export const Card = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { flush?: boolean }
>(({ className, flush, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      'rounded-card border border-line-subtle bg-surface-2',
      !flush && 'shadow-e1',
      className
    )}
    {...props}
  />
));
Card.displayName = 'Card';

export const CardHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex flex-col gap-1 px-5 pb-3 pt-4', className)} {...props} />
);

export const CardTitle = ({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => (
  <h3 className={cn('text-section text-ink-hi', className)} {...props} />
);

export const CardDescription = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <p className={cn('text-caption text-ink-mid', className)} {...props} />
);

export const CardContent = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('px-5 pb-5', className)} {...props} />
);

export const CardFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn('flex items-center gap-2 border-t border-line-subtle px-5 py-3', className)}
    {...props}
  />
);

/**
 * Etichetta di gruppo in mono maiuscolo: l'unico "settimo livello" ammesso.
 *
 * È `block`. Sembra un dettaglio e non lo è: come `<span>` inline finiva sulla
 * STESSA RIGA del controllo che etichettava — Stepper e Segmented sono
 * `inline-flex` — e nessun `space-y` del contenitore poteva separarli, perché
 * fra due elementi in linea non c'è spazio verticale da distribuire. Il
 * risultato era «LUNGHEZZA − 10 + brani» tutto attaccato.
 * Dove serve una etichetta in linea si passa `className="inline"`.
 */
export const Eyebrow = ({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) => (
  <span className={cn('block font-mono text-eyebrow uppercase text-ink-lo', className)} {...props} />
);

/** Intestazione di sezione dentro una pagina. */
export function SectionHeading({
  title,
  hint,
  actions,
  className
}: {
  title: React.ReactNode;
  hint?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-end justify-between gap-4', className)}>
      <div className="min-w-0">
        <div className="text-section text-ink-hi">{title}</div>
        {hint && <div className="mt-0.5 text-caption text-ink-mid">{hint}</div>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Riquadro statistico: numero in mono tabellare + etichetta + nota. */
export function StatTile({
  label,
  value,
  note,
  tone = 'neutral',
  icon,
  onClick
}: {
  label: string;
  value: React.ReactNode;
  note?: React.ReactNode;
  tone?: 'neutral' | 'accent' | 'warning' | 'destructive' | 'success';
  icon?: React.ReactNode;
  onClick?: () => void;
}) {
  const toneClass = {
    neutral: 'text-ink-hi',
    accent: 'text-accent',
    warning: 'text-warning',
    destructive: 'text-destructive',
    success: 'text-success'
  }[tone];
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      onClick={onClick}
      className={cn(
        'flex flex-col gap-1 rounded-card border border-line-subtle bg-surface-2 px-4 py-3.5 text-left',
        onClick && 'transition-colors duration-press hover:border-line-strong hover:bg-surface-hover'
      )}
    >
      <div className="flex items-center gap-2">
        {icon && <span className="text-ink-lo [&_svg]:size-3.5">{icon}</span>}
        <span className="text-caption text-ink-mid">{label}</span>
      </div>
      <div className={cn('font-mono text-data-lg tabular-nums', toneClass)}>{value}</div>
      {note && <div className="text-caption text-ink-lo">{note}</div>}
    </Tag>
  );
}

/** Placeholder di caricamento: mai "…". */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('cf-skeleton rounded-chip', className)} />;
}

export function SkeletonRows({ rows = 5, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('space-y-1.5', className)} aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-[var(--row-h)] w-full" />
      ))}
    </div>
  );
}
