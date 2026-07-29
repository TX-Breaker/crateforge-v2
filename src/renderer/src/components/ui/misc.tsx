import * as React from 'react';
import * as SwitchPrimitives from '@radix-ui/react-switch';
import * as ProgressPrimitive from '@radix-ui/react-progress';
import * as LabelPrimitive from '@radix-ui/react-label';
import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import * as SelectPrimitive from '@radix-ui/react-select';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Info,
  Minus,
  Plus,
  ShieldAlert,
  ShieldCheck
} from 'lucide-react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
import { useAppState } from '@/lib/appState';
import { CrateWatermark } from '@/components/Brand';

/* Riesportati da card.tsx: i componenti li importano da un posto solo. */
export { Skeleton, SkeletonRows } from './card';

/* ------------------------------------------------------------------ Switch */
export const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitives.Root
    className={cn(
      'peer inline-flex h-[21px] w-[38px] shrink-0 cursor-pointer items-center rounded-full border border-line',
      'transition-colors duration-press disabled:cursor-not-allowed disabled:opacity-45',
      'data-[state=checked]:border-accent data-[state=checked]:bg-accent data-[state=unchecked]:bg-surface-3',
      className
    )}
    {...props}
    ref={ref}
  >
    <SwitchPrimitives.Thumb
      className={cn(
        'pointer-events-none block size-[17px] translate-x-0.5 rounded-full bg-ink-hi shadow-e1',
        'transition-transform duration-press ease-swift',
        'data-[state=checked]:translate-x-[19px] data-[state=checked]:bg-accent-ink'
      )}
    />
  </SwitchPrimitives.Root>
));
Switch.displayName = 'Switch';

/* ---------------------------------------------------------------- Progress */
export const Progress = React.forwardRef<
  React.ElementRef<typeof ProgressPrimitive.Root>,
  Omit<React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root>, 'value'> & {
    value?: number | null;
    tone?: 'accent' | 'success' | 'destructive' | 'warning';
  }
>(({ className, value, tone = 'accent', ...props }, ref) => {
  const bar = {
    accent: 'bg-accent',
    success: 'bg-success',
    destructive: 'bg-destructive',
    warning: 'bg-warning'
  }[tone];
  // value null/undefined = indeterminato: una barra che spazza, non una
  // percentuale inventata (§4.6).
  return (
    <ProgressPrimitive.Root
      ref={ref}
      className={cn('relative h-1.5 w-full overflow-hidden rounded-full bg-surface-3', className)}
      {...props}
    >
      {value === null || value === undefined ? (
        <div className={cn('h-full w-1/3 animate-sweep rounded-full', bar)} />
      ) : (
        <ProgressPrimitive.Indicator
          className={cn('h-full rounded-full transition-[width] duration-swap ease-out', bar)}
          style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
        />
      )}
    </ProgressPrimitive.Root>
  );
});
Progress.displayName = 'Progress';

/** Barra orizzontale con etichetta e valore, usata dalla diagnosi. */
export function Meter({
  label,
  value,
  total,
  tone = 'warning',
  hint
}: {
  label: React.ReactNode;
  value: number;
  total: number;
  tone?: 'accent' | 'warning' | 'success' | 'destructive';
  hint?: React.ReactNode;
}) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-3">
        <span className="w-56 shrink-0 truncate text-body text-ink-hi">{label}</span>
        <span className="w-20 shrink-0 font-mono text-data tabular-nums text-ink-mid">
          {value.toLocaleString()}
        </span>
        <Progress className="flex-1" value={pct} tone={tone} />
        <span className="w-12 shrink-0 text-right font-mono text-caption tabular-nums text-ink-lo">
          {pct}%
        </span>
      </div>
      {hint && <p className="pl-[15.5rem] text-caption text-ink-lo">{hint}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------- Label */
export const Label = React.forwardRef<
  React.ElementRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root>
>(({ className, ...props }, ref) => (
  <LabelPrimitive.Root
    ref={ref}
    className={cn('text-body font-medium text-ink-hi', className)}
    {...props}
  />
));
Label.displayName = 'Label';

/** Campo etichettato con descrizione e messaggio d'errore. */
export function Field({
  label,
  hint,
  error,
  children,
  className
}: {
  label?: React.ReactNode;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      {label && <Label>{label}</Label>}
      {hint && <p className="text-caption text-ink-mid">{hint}</p>}
      {children}
      {error && (
        <p className="flex items-center gap-1.5 text-caption text-destructive">
          <AlertTriangle className="size-3" /> {error}
        </p>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- Checkbox */
export const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      'peer size-4 shrink-0 rounded-[4px] border border-line-strong bg-surface-3',
      'transition-colors duration-press disabled:cursor-not-allowed disabled:opacity-45',
      'data-[state=checked]:border-accent data-[state=checked]:bg-accent data-[state=checked]:text-accent-ink',
      'data-[state=indeterminate]:border-accent data-[state=indeterminate]:bg-accent data-[state=indeterminate]:text-accent-ink',
      className
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator className="flex items-center justify-center text-current">
      {props.checked === 'indeterminate' ? (
        <Minus className="size-3" strokeWidth={3} />
      ) : (
        <Check className="size-3" strokeWidth={3} />
      )}
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
));
Checkbox.displayName = 'Checkbox';

/* ------------------------------------------------------------------- Input */
export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean; mono?: boolean }
>(({ className, type, invalid, mono, ...props }, ref) => (
  <input
    type={type}
    aria-invalid={invalid || undefined}
    className={cn(
      'flex h-[34px] w-full rounded-control border border-line bg-surface-3 px-3 text-body text-ink-hi',
      'transition-colors duration-press placeholder:text-ink-lo',
      'hover:border-line-strong focus-visible:border-accent',
      'disabled:cursor-not-allowed disabled:opacity-45',
      invalid && 'border-destructive focus-visible:border-destructive',
      mono && 'font-mono text-data tabular-nums',
      className
    )}
    ref={ref}
    {...props}
  />
));
Input.displayName = 'Input';

/* ------------------------------------------------------------------ Select */
export function Select({
  value,
  onValueChange,
  options,
  placeholder,
  className,
  disabled,
  label
}: {
  value: string;
  onValueChange: (v: string) => void;
  options: { value: string; label: string; hint?: string }[];
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  /** nome accessibile: l'etichetta sopra il controllo non basta a nominarlo */
  label?: string;
}) {
  return (
    <SelectPrimitive.Root value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectPrimitive.Trigger
        aria-label={label}
        className={cn(
          'flex h-[34px] items-center justify-between gap-2 rounded-control border border-line bg-surface-3 px-3',
          'text-body text-ink-hi transition-colors duration-press hover:border-line-strong',
          'disabled:cursor-not-allowed disabled:opacity-45',
          className
        )}
      >
        <SelectPrimitive.Value placeholder={placeholder} />
        <SelectPrimitive.Icon>
          <ChevronDown className="size-3.5 text-ink-lo" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={6}
          className="z-50 min-w-[--radix-select-trigger-width] overflow-hidden rounded-card border border-line bg-surface-2 shadow-e2 animate-scale-in"
        >
          <SelectPrimitive.Viewport className="p-1">
            {options.map((o) => (
              <SelectPrimitive.Item
                key={o.value}
                value={o.value}
                className="flex cursor-pointer select-none items-center gap-2 rounded-chip px-2.5 py-1.5 text-body text-ink-mid outline-none data-[highlighted]:bg-surface-hover data-[state=checked]:text-ink-hi"
              >
                <SelectPrimitive.ItemIndicator>
                  <Check className="size-3.5 text-accent" />
                </SelectPrimitive.ItemIndicator>
                <SelectPrimitive.ItemText>{o.label}</SelectPrimitive.ItemText>
                {o.hint && <span className="ml-auto text-caption text-ink-lo">{o.hint}</span>}
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}

/* --------------------------------------------------------------- Segmented */
/** Scelta esclusiva breve (dry-run / esegui, comodo / compatto). */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  size = 'md',
  className,
  disabled = false
}: {
  value: T;
  onChange: (v: T) => void;
  options: {
    value: T;
    label: React.ReactNode;
    icon?: React.ReactNode;
    tone?: 'default' | 'destructive';
  }[];
  size?: 'sm' | 'md';
  className?: string;
  /** Gruppo inerte: resta leggibile e annunciato, ma non si cambia. */
  disabled?: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-disabled={disabled || undefined}
      className={cn(
        'inline-flex items-center gap-0.5 rounded-control border border-line bg-surface-3 p-0.5',
        disabled && 'opacity-55',
        className
      )}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            className={cn(
              disabled && 'cursor-not-allowed',
              'inline-flex items-center gap-1.5 rounded-[4px] px-2.5 font-medium transition-colors duration-press',
              size === 'sm' ? 'h-6 text-caption' : 'h-7 text-body',
              active
                ? o.tone === 'destructive'
                  ? 'bg-destructive text-destructive-ink'
                  : 'bg-accent text-accent-ink'
                : 'text-ink-mid hover:bg-surface-hover hover:text-ink-hi',
              '[&_svg]:size-3.5'
            )}
          >
            {o.icon}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* ----------------------------------------------------------------- Stepper */
export function Stepper({
  value,
  onChange,
  min = 0,
  max = 999,
  step = 1,
  suffix,
  label
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: React.ReactNode;
  /** nome accessibile del campo numerico */
  label?: string;
}) {
  const clampV = (v: number) => Math.min(max, Math.max(min, v));
  return (
    <div className="inline-flex h-[34px] items-center overflow-hidden rounded-control border border-line bg-surface-3">
      <button
        type="button"
        aria-label="−"
        onClick={() => onChange(clampV(value - step))}
        disabled={value <= min}
        className="grid h-full w-8 place-items-center border-r border-line text-ink-mid transition-colors duration-press hover:bg-surface-hover hover:text-ink-hi disabled:opacity-40"
      >
        <Minus className="size-3.5" />
      </button>
      <input
        value={value}
        aria-label={label}
        onChange={(e) => {
          const n = Number(e.target.value.replace(/[^\d-]/g, ''));
          if (Number.isFinite(n)) onChange(clampV(n));
        }}
        className="h-full w-12 bg-transparent text-center font-mono text-data tabular-nums text-ink-hi"
      />
      <button
        type="button"
        aria-label="+"
        onClick={() => onChange(clampV(value + step))}
        disabled={value >= max}
        className="grid h-full w-8 place-items-center border-l border-line text-ink-mid transition-colors duration-press hover:bg-surface-hover hover:text-ink-hi disabled:opacity-40"
      >
        <Plus className="size-3.5" />
      </button>
      {suffix && <span className="ml-1 text-caption text-ink-lo">{suffix}</span>}
    </div>
  );
}

/* ------------------------------------------------------------------- Badge */
const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-chip px-1.5 py-0.5 text-caption font-medium [&_svg]:size-3',
  {
    variants: {
      variant: {
        neutral: 'bg-surface-3 text-ink-mid',
        outline: 'border border-line text-ink-mid',
        accent: 'bg-accent/15 text-accent',
        warning: 'bg-warning/15 text-warning',
        destructive: 'bg-destructive/15 text-destructive',
        success: 'bg-success/15 text-success',
        solid: 'bg-accent text-accent-ink'
      }
    },
    defaultVariants: { variant: 'neutral' }
  }
);
export function Badge({
  className,
  variant,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

/** Chip di filtro attivabile, con contatore opzionale. */
/**
 * Numero del chip (§8.2). Sopra 9.999 si abbrevia, altrimenti separatore
 * locale: un chip largo quanto la frase che contiene smette di essere un chip.
 */
function chipCount(n: number, locale: string): string {
  if (n > 9999) {
    const k = n / 1000;
    return `${(k >= 100 ? Math.round(k) : Math.round(k * 10) / 10).toLocaleString(locale)}k`;
  }
  return n.toLocaleString(locale);
}

/**
 * Chip di filtro con contatore (§8.2).
 *
 * Un filtro che non dice quanto nasconderà è un'ipotesi. Il numero però compare
 * SOLO se è già noto senza lavoro extra: un chip che dovesse interrogare il
 * database per etichettarsi non mostra niente — mai un indicatore di
 * caricamento, mai un numero vecchio della scansione precedente.
 *
 * Quattro stati:
 *  - attivo: chip in accento, numero in accento a piena forza;
 *  - inattivo: numero a `text-lo`, così l'etichetta resta l'enfasi e il numero
 *    resta disponibile;
 *  - zero: il chip RESTA, spento a `text-disabled`. Un filtro che sparisce
 *    quando non trova nulla è un filtro di cui non ci si fida: "0" è la
 *    risposta utile;
 *  - sconosciuto: nessun numero.
 *
 * I numeri non si animano mai: un contatore che sale a ogni cambio di filtro
 * trasforma l'intestazione di una lista in un'attesa.
 */
export function FilterChip({
  active,
  count,
  children,
  onClick
}: {
  active?: boolean;
  count?: number;
  children: React.ReactNode;
  onClick?: () => void;
}) {
  const { locale } = useAppState();
  const zero = count === 0;
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-1 text-caption transition-colors duration-press',
        active
          ? 'border-accent bg-accent/15 text-accent'
          : zero
            ? 'border-line bg-surface-3 text-ink-disabled hover:border-line-strong hover:text-ink-mid'
            : 'border-line bg-surface-3 text-ink-mid hover:border-line-strong hover:text-ink-hi'
      )}
    >
      {children}
      {count !== undefined && (
        <span
          /* 7px di stacco dall'etichetta, mono 500 tabulare: il numero deve
             restare incolonnato mentre i chip cambiano larghezza. */
          className={cn(
            'ml-[7px] font-mono text-[11px] font-medium tabular-nums',
            active ? 'text-accent' : zero ? 'text-ink-disabled' : 'text-ink-lo'
          )}
        >
          {chipCount(count, locale)}
        </span>
      )}
    </button>
  );
}

/* ------------------------------------------------------------ Inline notice */
const noticeVariants = cva('rounded-card border px-3.5 py-3 text-body', {
  variants: {
    variant: {
      info: 'border-line bg-surface-3',
      accent: 'border-accent/40 bg-accent/[.08]',
      warning: 'border-warning/45 bg-warning/[.09]',
      destructive: 'border-destructive/50 bg-destructive/[.09]',
      success: 'border-success/45 bg-success/[.09]'
    }
  },
  defaultVariants: { variant: 'info' }
});

/**
 * Avviso inline (§4.4). I limiti dichiarati e i rischi vivono QUI, persistenti
 * sulla pagina: nei toast va solo l'esito.
 */
export function Notice({
  variant = 'info',
  title,
  icon,
  children,
  actions,
  className
}: {
  variant?: 'info' | 'accent' | 'warning' | 'destructive' | 'success';
  title?: React.ReactNode;
  icon?: React.ReactNode;
  children?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  const defaultIcon = {
    info: <Info />,
    accent: <Info />,
    warning: <AlertTriangle />,
    destructive: <ShieldAlert />,
    success: <ShieldCheck />
  }[variant];
  const iconTone = {
    info: 'text-ink-lo',
    accent: 'text-accent',
    warning: 'text-warning',
    destructive: 'text-destructive',
    success: 'text-success'
  }[variant];
  return (
    <div role="note" className={cn(noticeVariants({ variant }), className)}>
      <div className="flex gap-2.5">
        <span className={cn('mt-px shrink-0 [&_svg]:size-4', iconTone)}>{icon ?? defaultIcon}</span>
        <div className="min-w-0 flex-1 space-y-1">
          {title && <div className="text-body font-semibold text-ink-hi">{title}</div>}
          {children && <div className="text-caption leading-[17px] text-ink-mid">{children}</div>}
          {actions && <div className="flex flex-wrap gap-2 pt-1.5">{actions}</div>}
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------- Tabs */
export const Tabs = TabsPrimitive.Root;

export const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn('inline-flex items-center gap-1 border-b border-line-subtle', className)}
    {...props}
  />
));
TabsList.displayName = 'TabsList';

export const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger> & { count?: number }
>(({ className, children, count, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      'relative -mb-px inline-flex items-center gap-2 whitespace-nowrap border-b-2 border-transparent px-3 pb-2 pt-1.5',
      'text-body font-medium text-ink-mid transition-colors duration-swap hover:text-ink-hi',
      'data-[state=active]:border-accent data-[state=active]:text-ink-hi',
      '[&_svg]:size-3.5',
      className
    )}
    {...props}
  >
    {children}
    {count !== undefined && (
      <span className="font-mono text-caption tabular-nums text-ink-lo">
        {count.toLocaleString()}
      </span>
    )}
  </TabsPrimitive.Trigger>
));
TabsTrigger.displayName = 'TabsTrigger';

export const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn('mt-4 outline-none animate-fade-in', className)}
    {...props}
  />
));
TabsContent.displayName = 'TabsContent';

/* ----------------------------------------------------------------- Tooltip */
export const TooltipProvider = TooltipPrimitive.Provider;

export function Tooltip({
  content,
  children,
  side = 'top'
}: {
  content: React.ReactNode;
  children: React.ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
}) {
  if (!content) return <>{children}</>;
  return (
    <TooltipPrimitive.Root delayDuration={350}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          className="z-50 max-w-xs rounded-control border border-line bg-surface-2 px-2.5 py-1.5 text-caption text-ink-mid shadow-e2 animate-fade-in"
        >
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

/* ------------------------------------------------------------- Empty state */
/** Stato vuoto (§4.7): mai un trattino muto. Sempre motivo + via d'uscita. */
export function EmptyState({
  icon,
  title,
  children,
  action,
  className,
  watermark = false
}: {
  icon?: React.ReactNode;
  title: React.ReactNode;
  children?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  /**
   * Filigrana del marchio dietro il contenuto. Spenta ovunque per scelta: gli
   * stati vuoti del design system sono nudi, e ripeterla su tutti avrebbe
   * riscritto l'aspetto di mezza applicazione. Si accende in un solo punto —
   * la libreria ancora vuota — dove il marchio è il messaggio.
   */
  watermark?: boolean;
}) {
  return (
    <div
      className={cn(
        'relative flex flex-col items-center gap-3 overflow-hidden rounded-card border border-dashed border-line px-6 py-10 text-center',
        className
      )}
    >
      {/* Resa "Disabled · watermark" della specifica logo §04: filigrana spenta,
          mai con l'accento — l'ambra significa "questa è la selezione", e una
          filigrana non seleziona niente. Dice di chi è la finestra senza
          rubare l'attenzione al testo che spiega cosa fare. */}
      {watermark && (
        <span aria-hidden className="pointer-events-none absolute inset-0 grid place-items-center">
          <CrateWatermark size={104} />
        </span>
      )}
      {icon && (
        <span className="relative grid size-10 place-items-center rounded-full bg-surface-3 text-ink-lo [&_svg]:size-5">
          {icon}
        </span>
      )}
      <div className="relative space-y-1">
        <div className="text-section text-ink-hi">{title}</div>
        {children && <p className="mx-auto max-w-md text-caption text-ink-mid">{children}</p>}
      </div>
      {action && <div className="relative">{action}</div>}
    </div>
  );
}

/** Coppia etichetta/valore in mono, per i pannelli di dettaglio. */
export function KeyValue({
  label,
  value,
  tone
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  tone?: 'warning' | 'destructive' | 'success' | 'accent';
}) {
  const toneClass = tone
    ? {
        warning: 'text-warning',
        destructive: 'text-destructive',
        success: 'text-success',
        accent: 'text-accent'
      }[tone]
    : 'text-ink-hi';
  return (
    <div className="min-w-0 space-y-0.5">
      <div className="font-mono text-eyebrow uppercase text-ink-lo">{label}</div>
      <div className={cn('truncate text-body', toneClass)}>{value}</div>
    </div>
  );
}
