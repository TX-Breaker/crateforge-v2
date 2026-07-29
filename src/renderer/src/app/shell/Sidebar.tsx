import { ChevronsLeft, Search, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAppState } from '@/lib/appState';
import { useRouter } from '@/lib/router';
import { useLibrary } from '@/lib/library';
import { t } from '@/lib/i18n';
import { shortcut } from '@/lib/platform';
import { Tooltip } from '@/components/ui/misc';
import { CrateTile } from '@/components/Brand';
import { GROUPS, visibleRoutes, type RouteDef } from '@/app/routes';

/**
 * Sidebar (§3): sei gruppi semantici, contatori vivi sul bordo destro,
 * collasso a 68px con le icone sempre visibili.
 *
 * Segnale della modalità Esperto (§3.2, proposta B): l'intera colonna passa a
 * un tono più caldo e più scuro e prende un chip in testata; ogni destinazione
 * sperimentale porta un punto. Persistente e inequivocabile, non costa spazio
 * di layout e non compete con un avviso vero.
 */
export function Sidebar({
  collapsed,
  onToggleCollapse,
  onOpenPalette
}: {
  collapsed: boolean;
  onToggleCollapse: () => void;
  onOpenPalette: () => void;
}) {
  const { mode, locale } = useAppState();
  const { route, go } = useRouter();
  const { stats, health, arrivals } = useLibrary();
  const expert = mode === 'expert';
  const routes = visibleRoutes(expert);

  const counterFor = (r: RouteDef): string | null => {
    if (!r.counter) return null;
    if (r.counter === 'health') return health ? String(health.score) : null;
    if (r.counter === 'tracks') return stats ? stats.tracks.toLocaleString(locale) : null;
    if (r.counter === 'review')
      return stats && stats.needsReview > 0 ? stats.needsReview.toLocaleString(locale) : null;
    if (r.counter === 'arrivals') return arrivals > 0 ? String(arrivals) : null;
    return null;
  };

  return (
    <aside
      className={cn(
        'flex shrink-0 flex-col border-r border-line-subtle transition-[width,background-color] duration-swap ease-swift',
        collapsed ? 'w-sidebar-collapsed' : 'w-sidebar',
        expert ? 'bg-surface-expert' : 'bg-surface-1'
      )}
    >
      {/* marchio + versione */}
      <div className={cn('flex items-center gap-2.5 px-4 pb-3 pt-4', collapsed && 'justify-center px-0')}>
        {/* Disegno C a 22px (specifica logo §03 e §05): è la stessa piastrella
            che, con la colonna collassata a 68px, resta da sola al centro — per
            questo il marchio doveva funzionare a 22px senza la parola. */}
        <CrateTile size={22} radius={5} />
        {!collapsed && (
          <>
            <span className="text-body font-semibold tracking-tight text-ink-hi">CrateForge</span>
            <span className="ml-auto font-mono text-[9.5px] tracking-[.08em] text-ink-lo">
              V2.0.0
            </span>
          </>
        )}
      </div>

      {/* chip modalità Esperto */}
      {expert && !collapsed && (
        <div className="mx-3 mb-2 flex items-center gap-1.5 rounded-chip bg-warning/15 px-2 py-1">
          <span className="size-1.5 rounded-full bg-warning" />
          <span className="font-mono text-[9.5px] font-bold uppercase tracking-[.12em] text-warning">
            {t(locale, 'mode.expert')}
          </span>
        </div>
      )}

      {/* apertura palette comandi */}
      <button
        onClick={onOpenPalette}
        className={cn(
          'mx-3 mb-3 flex h-8 items-center gap-2 rounded-control border border-line bg-surface-3 px-2.5',
          'text-caption text-ink-lo transition-colors duration-press hover:border-line-strong hover:text-ink-mid',
          collapsed && 'mx-2 justify-center px-0'
        )}
      >
        <Search className="size-3.5 shrink-0" />
        {!collapsed && (
          <>
            <span className="truncate">{t(locale, 'common.search')}</span>
            <kbd className="ml-auto rounded-[3px] border border-line px-1 font-mono text-[9.5px] text-ink-lo">
              {shortcut('K')}
            </kbd>
          </>
        )}
      </button>

      <nav className="flex-1 overflow-y-auto px-2 pb-2">
        {GROUPS.map((g) => {
          const items = routes.filter((r) => r.group === g.id);
          if (items.length === 0) return null;
          return (
            <div key={g.id} className="mb-3">
              {!collapsed && (
                <div className="px-2 pb-1.5 pt-1 font-mono text-[9.5px] uppercase tracking-[.14em] text-ink-lo">
                  {t(locale, g.labelKey)}
                </div>
              )}
              <div className="space-y-0.5">
                {items.map((r) => {
                  const active = route === r.id;
                  const counter = counterFor(r);
                  const item = (
                    <button
                      key={r.id}
                      onClick={() => go(r.id)}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'group flex w-full items-center gap-2.5 rounded-control px-2.5 py-[7px] text-left',
                        'transition-colors duration-press [&_svg]:size-4 [&_svg]:shrink-0',
                        collapsed && 'justify-center px-0',
                        active
                          ? 'bg-accent/15 text-ink-hi'
                          : 'text-ink-mid hover:bg-surface-hover hover:text-ink-hi'
                      )}
                    >
                      <span className={cn(active ? 'text-accent' : 'text-ink-lo')}>{r.icon}</span>
                      {!collapsed && (
                        <>
                          <span className="flex-1 truncate text-body">{t(locale, r.labelKey)}</span>
                          {r.expertOnly && (
                            <span
                              className="size-1.5 shrink-0 rounded-full bg-warning"
                              aria-label={t(locale, 'mode.expert')}
                            />
                          )}
                          {counter && (
                            <span className="shrink-0 font-mono text-[10.5px] tabular-nums text-ink-lo">
                              {counter}
                            </span>
                          )}
                        </>
                      )}
                    </button>
                  );
                  return collapsed ? (
                    <Tooltip key={r.id} side="right" content={t(locale, r.labelKey)}>
                      {item}
                    </Tooltip>
                  ) : (
                    item
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>

      <div className="border-t border-line-subtle p-2">
        {!collapsed && (
          <div className="mb-2 flex gap-2 px-1.5 py-1 text-[10.5px] leading-[14px] text-ink-lo">
            <ShieldCheck className="mt-px size-3.5 shrink-0 text-success" />
            <span>{t(locale, 'safety.readonly')}</span>
          </div>
        )}
        <button
          onClick={onToggleCollapse}
          className={cn(
            'flex h-7 w-full items-center gap-2 rounded-control px-2 text-caption text-ink-lo',
            'transition-colors duration-press hover:bg-surface-hover hover:text-ink-mid',
            collapsed && 'justify-center px-0'
          )}
        >
          <ChevronsLeft
            className={cn('size-3.5 transition-transform duration-swap', collapsed && 'rotate-180')}
          />
          {!collapsed && t(locale, 'common.collapse')}
        </button>
      </div>
    </aside>
  );
}
