import * as React from 'react';
import { ChevronDown, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/strings';
import { Button } from './button';
import { Tooltip } from './misc';

/**
 * Mattoni di impaginazione delle schermate. Pochi e sempre uguali, così ogni
 * schermata si legge allo stesso modo: titolo e azione principale in alto,
 * sezioni con un titolo breve, il resto dietro un'icona ⓘ.
 */

/** Intestazione della schermata: titolo a sinistra, azioni a destra. */
export function PageHeader({
  title,
  children,
  aside
}: {
  title: React.ReactNode;
  /** Azioni, allineate a destra. */
  children?: React.ReactNode;
  /** Riga breve sotto il titolo (un numero, uno stato). Niente paragrafi. */
  aside?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end gap-3">
      <div className="min-w-0">
        <h1 className="text-title text-ink-hi">{title}</h1>
        {aside && <div className="mt-1 text-body text-ink-mid">{aside}</div>}
      </div>
      {children && <div className="ml-auto flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

/** Sezione con titolo breve. Il contorno è sottile: le sezioni non sono schede da scorrere. */
export function Section({
  title,
  tip,
  actions,
  children,
  className
}: {
  title?: React.ReactNode;
  tip?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('rounded-card border border-line-subtle bg-surface-1 p-5', className)}>
      {(title || actions) && (
        <div className="mb-4 flex items-center gap-2">
          {title && <h2 className="text-section text-ink-hi">{title}</h2>}
          {tip && <InfoTip text={tip} />}
          {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

/** Spiegazione a richiesta: l'icona ⓘ. Il testo lungo vive qui, non sullo schermo. */
export function InfoTip({ text }: { text: string }) {
  return (
    <Tooltip content={<span className="block max-w-[300px] leading-[17px]">{text}</span>}>
      <button
        type="button"
        aria-label={text}
        className="grid size-5 place-items-center rounded-full text-ink-lo transition-colors duration-press hover:text-ink-hi"
      >
        <Info className="size-3.5" />
      </button>
    </Tooltip>
  );
}

/** Un numero grande con la sua etichetta. Cliccabile se porta da qualche parte. */
export function Figure({
  value,
  label,
  tone = 'default',
  onClick
}: {
  value: React.ReactNode;
  label: React.ReactNode;
  tone?: 'default' | 'warning' | 'good';
  onClick?: () => void;
}) {
  const body = (
    <>
      <span
        className={cn(
          'block font-mono text-data-lg tabular-nums',
          tone === 'warning' ? 'text-warning' : tone === 'good' ? 'text-success' : 'text-ink-hi'
        )}
      >
        {value}
      </span>
      <span className="mt-1 block text-caption text-ink-mid">{label}</span>
    </>
  );
  const cls = 'rounded-card border border-line-subtle bg-surface-1 px-4 py-3.5 text-left';
  return onClick ? (
    <button
      type="button"
      onClick={onClick}
      className={cn(cls, 'transition-colors duration-press hover:border-line-strong hover:bg-surface-hover')}
    >
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/**
 * Conferma in linea: il pulsante diventa «Sicuro? No / Sì» al suo posto.
 *
 * Per le azioni che si possono annullare o ripetere. Le scritture sui file
 * originali dell'utente usano invece la conferma con parola chiave
 * (`DangerConfirmDialog`), che resta di proposito più pesante.
 */
export function InlineConfirm({
  children,
  onConfirm,
  variant = 'secondary',
  size = 'md',
  disabled
}: {
  children: React.ReactNode;
  onConfirm: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'destructive';
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
}) {
  const t = useT();
  const [asking, setAsking] = React.useState(false);
  if (!asking) {
    return (
      <Button variant={variant} size={size} disabled={disabled} onClick={() => setAsking(true)}>
        {children}
      </Button>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-caption text-ink-mid">{t('c.sure')}</span>
      <Button size={size} variant="ghost" onClick={() => setAsking(false)}>
        {t('c.no')}
      </Button>
      <Button
        size={size}
        variant={variant === 'destructive' ? 'destructive' : 'primary'}
        onClick={() => {
          setAsking(false);
          onConfirm();
        }}
      >
        {t('c.yes')}
      </Button>
    </span>
  );
}

/** «Opzioni»: ciò che serve di rado, chiuso finché non lo si chiede. */
export function Disclosure({
  label,
  children,
  defaultOpen = false
}: {
  label?: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const t = useT();
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-1.5 text-caption text-ink-mid transition-colors duration-press hover:text-ink-hi"
      >
        <ChevronDown className={cn('size-3.5 transition-transform duration-swap', open ? '' : '-rotate-90')} />
        {label ?? t('c.options')}
      </button>
      {open && <div className="mt-3 space-y-3">{children}</div>}
    </div>
  );
}

/** Scelta multipla a piastrelle: per software, destinazioni, categorie. */
export function ChoiceTile({
  selected,
  onClick,
  icon,
  title,
  hint,
  badge,
  disabled
}: {
  selected: boolean;
  onClick: () => void;
  icon?: React.ReactNode;
  title: React.ReactNode;
  hint?: React.ReactNode;
  badge?: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={selected}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex items-center gap-3 rounded-card border px-4 py-3 text-left transition-colors duration-press',
        'disabled:cursor-not-allowed disabled:opacity-45',
        selected
          ? 'border-accent bg-accent/10'
          : 'border-line-subtle bg-surface-1 hover:border-line-strong hover:bg-surface-hover'
      )}
    >
      {icon && (
        <span className={cn('[&_svg]:size-[18px]', selected ? 'text-accent' : 'text-ink-lo')}>{icon}</span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body font-medium text-ink-hi">{title}</span>
        {hint && <span className="block truncate text-caption text-ink-lo">{hint}</span>}
      </span>
      {badge}
    </button>
  );
}
