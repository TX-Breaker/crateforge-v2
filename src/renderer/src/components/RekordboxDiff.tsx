import { cn } from '@/lib/utils';
import { useAppState } from '@/lib/appState';
import { pageText } from '@/lib/i18nPages';

/**
 * Card "rispetto a Rekordbox" (§4.5): per ogni funzione spiega la differenza
 * col comportamento nativo e il beneficio concreto. Il testo per pagina vive
 * nel namespace `rbdiff` di i18nPages.
 *
 * `stats` (opzionale) mostra i numeri dell'ultima esecuzione: è la forma che
 * il design chiama "insight card", non un banner decorativo.
 */
export function RekordboxDiff({
  page,
  stats,
  className
}: {
  page: string;
  stats?: { value: React.ReactNode; label: React.ReactNode; tone?: 'accent' | 'warning' | 'destructive' }[];
  className?: string;
}) {
  const { locale } = useAppState();
  const text = pageText(locale, 'rbdiff', page);
  if (!text || text === page) return null;

  return (
    <div
      className={cn(
        'flex gap-3 rounded-card border border-accent/30 bg-accent/[.06] px-3.5 py-3',
        className
      )}
    >
      <span className="mt-px grid size-6 shrink-0 place-items-center rounded-chip bg-accent/20 font-mono text-[9px] font-bold tracking-tight text-accent">
        RB
      </span>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="font-mono text-eyebrow uppercase text-accent">
          {pageText(locale, 'rbdiff', 'label')}
        </div>
        <p className="text-caption leading-[17px] text-ink-mid">{text}</p>
        {stats && stats.length > 0 && (
          <div className="flex flex-wrap gap-6 pt-1">
            {stats.map((s, i) => (
              <div key={i}>
                <div
                  className={cn(
                    'font-mono text-data-lg tabular-nums',
                    s.tone === 'warning'
                      ? 'text-warning'
                      : s.tone === 'destructive'
                        ? 'text-destructive'
                        : 'text-ink-hi'
                  )}
                >
                  {s.value}
                </div>
                <div className="text-caption text-ink-lo">{s.label}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
