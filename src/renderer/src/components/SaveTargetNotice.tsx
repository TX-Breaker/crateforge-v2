import { Copy, Database, FileOutput, FileWarning, HardDrive } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAppState } from '@/lib/appState';
import { t, type MsgKey } from '@/lib/i18n';

export type SaveTarget = 'udm' | 'copy' | 'xml' | 'original' | 'masterdb';

/**
 * Dichiarazione della destinazione di scrittura (§4.3) — il componente più
 * importante dell'app. In V1 era un badge grigio; qui è una riga a piena
 * larghezza il cui colore sale con il rischio. Non è mai collassata, non è mai
 * dietro una disclosure, e compare sia PRIMA (cosa succederà) sia DOPO
 * (cosa è successo) l'operazione.
 */
const MAP: Record<
  SaveTarget,
  {
    icon: React.ReactNode;
    tone: 'neutral' | 'success' | 'accent' | 'warning' | 'destructive';
    label: MsgKey;
    title: MsgKey;
    body: MsgKey;
  }
> = {
  udm: {
    icon: <Database />,
    tone: 'neutral',
    label: 'target.udm.tag',
    title: 'target.udm.title',
    body: 'target.udm.body'
  },
  copy: {
    icon: <Copy />,
    tone: 'success',
    label: 'target.copy.tag',
    title: 'target.copy.title',
    body: 'target.copy.body'
  },
  xml: {
    icon: <FileOutput />,
    tone: 'accent',
    label: 'target.xml.tag',
    title: 'target.xml.title',
    body: 'target.xml.body'
  },
  original: {
    icon: <FileWarning />,
    tone: 'warning',
    label: 'target.original.tag',
    title: 'target.original.title',
    body: 'target.original.body'
  },
  masterdb: {
    icon: <HardDrive />,
    tone: 'destructive',
    label: 'target.masterdb.tag',
    title: 'target.masterdb.title',
    body: 'target.masterdb.body'
  }
};

/* Cinque gradini, uno per bersaglio: il colore SALE con il rischio (§4.3).
   Prima "copia" e "solo database interno" erano lo stesso grigio, e la
   dichiarazione più frequente dell'app — il backup — sembrava identica a
   "non scrivo niente". La barra a sinistra porta lo stesso salto anche a chi
   non distingue le tinte. */
const TONE = {
  neutral: {
    wrap: 'border-line bg-surface-3 border-l-[3px] border-l-ink-lo',
    tag: 'bg-surface-hover text-ink-mid',
    icon: 'text-ink-lo'
  },
  success: {
    wrap: 'border-line bg-surface-3 border-l-[3px] border-l-success',
    tag: 'bg-success/20 text-success',
    icon: 'text-success'
  },
  accent: {
    wrap: 'border-accent/40 bg-accent/[.08] border-l-[3px] border-l-accent',
    tag: 'bg-accent/20 text-accent',
    icon: 'text-accent'
  },
  warning: {
    wrap: 'border-warning/50 bg-warning/[.1] border-l-[3px] border-l-warning',
    tag: 'bg-warning/25 text-warning',
    icon: 'text-warning'
  },
  destructive: {
    wrap: 'border-destructive/55 bg-destructive/[.1] border-l-[3px] border-l-destructive',
    tag: 'bg-destructive/25 text-destructive',
    icon: 'text-destructive'
  }
};

export function SaveTargetNotice({
  target,
  detail,
  className
}: {
  target: SaveTarget;
  /** percorso o numeri concreti dell'operazione appena eseguita */
  detail?: React.ReactNode;
  className?: string;
}) {
  const { locale } = useAppState();
  const m = MAP[target];
  const tone = TONE[m.tone];
  return (
    <div
      className={cn('flex items-start gap-3 rounded-card border px-3.5 py-3', tone.wrap, className)}
    >
      <span className={cn('mt-0.5 shrink-0 [&_svg]:size-4', tone.icon)}>{m.icon}</span>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              'rounded-chip px-1.5 py-0.5 font-mono text-[9.5px] font-bold uppercase tracking-[.1em]',
              tone.tag
            )}
          >
            {t(locale, m.label)}
          </span>
          <span className="text-body font-semibold text-ink-hi">{t(locale, m.title)}</span>
        </div>
        <p className="text-caption leading-[17px] text-ink-mid">{t(locale, m.body)}</p>
        {detail && (
          <p className="truncate font-mono text-caption tabular-nums text-ink-lo" data-selectable>
            {detail}
          </p>
        )}
      </div>
    </div>
  );
}

/** Forma compatta per le tabelle (Registro operazioni). */
export function SaveTargetBadge({ target }: { target: SaveTarget }) {
  const { locale } = useAppState();
  const m = MAP[target];
  const tone = TONE[m.tone];
  return (
    <span
      title={t(locale, m.title)}
      className={cn(
        'inline-flex items-center rounded-chip px-1.5 py-0.5 font-mono text-[9.5px] font-bold uppercase tracking-[.08em]',
        tone.tag
      )}
    >
      {t(locale, m.label)}
    </span>
  );
}
