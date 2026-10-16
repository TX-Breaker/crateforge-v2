import * as React from 'react';
import { Checkbox } from '@/components/ui/misc';
import { useT } from '@/lib/strings';
import { cn } from '@/lib/utils';

/** Una riga spuntabile negli elenchi degli strumenti. */
export function CheckRow({
  checked,
  onToggle,
  disabled,
  children,
  aside
}: {
  checked: boolean;
  onToggle: () => void;
  disabled?: boolean;
  children: React.ReactNode;
  aside?: React.ReactNode;
}) {
  return (
    <label
      className={cn(
        'flex items-center gap-2.5 px-3 py-2 transition-colors duration-press',
        disabled ? 'cursor-not-allowed opacity-55' : 'cursor-pointer hover:bg-surface-hover'
      )}
    >
      <Checkbox checked={checked} disabled={disabled} onCheckedChange={onToggle} />
      <span className="min-w-0 flex-1 truncate text-body text-ink-hi">{children}</span>
      {aside}
    </label>
  );
}

/** Contenitore a lista con bordo e scorrimento. */
export function RowList({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'max-h-[52vh] divide-y divide-line-subtle overflow-auto rounded-card border border-line-subtle',
        className
      )}
    >
      {children}
    </div>
  );
}

/** «Tutti / Nessuno» con il conteggio della selezione. */
export function SelectBar({
  count,
  onAll,
  onNone
}: {
  count: number;
  onAll: () => void;
  onNone: () => void;
}) {
  const t = useT();
  return (
    <div className="flex items-center gap-3 text-caption text-ink-lo">
      <span className="tabular-nums">{t('c.selected', { n: count })}</span>
      <button className="text-ink-mid hover:text-ink-hi" onClick={onAll}>
        {t('c.selectAll')}
      </button>
      <button className="text-ink-mid hover:text-ink-hi" onClick={onNone}>
        {t('c.selectNone')}
      </button>
    </div>
  );
}

export function toggleIn<T>(set: Set<T>, v: T): Set<T> {
  const next = new Set(set);
  if (next.has(v)) next.delete(v);
  else next.add(v);
  return next;
}

export const trackName = (t: { artist?: string | null; title?: string | null }) =>
  [t.artist, t.title].filter(Boolean).join(' — ') || '—';
