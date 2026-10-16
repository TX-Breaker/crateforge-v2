import { useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { AlertTriangle, Bell, ChevronsLeft, Moon, Search, ShieldCheck, Sun } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAppState } from '@/lib/appState';
import { useRouter } from '@/lib/router';
import { useLibrary } from '@/lib/library';
import { useNotifications } from '@/lib/notifications';
import { openIssueCount } from '@/lib/issues';
import { useT } from '@/lib/strings';
import { shortcut } from '@/lib/platform';
import { Tooltip } from '@/components/ui/misc';
import { CrateTile } from '@/components/Brand';
import { NotificationCenter } from '@/components/NotificationCenter';
import { ROUTES, type RouteDef } from '@/app/routes';

/**
 * Colonna di navigazione: sette voci, nessun gruppo.
 *
 * In fondo vivono le tre cose che prima occupavano una barra in alto e una in
 * basso: notifiche, tema, e lo stato del modulo di analisi — mostrato solo
 * quando qualcosa non va. Uno stato sano non ha bisogno di dirlo in continuazione.
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
  const t = useT();
  const { locale, isDark, setTheme } = useAppState();
  const { route, go } = useRouter();
  const { stats, health, preflight, sidecar } = useLibrary();
  const { unread } = useNotifications();
  const [bellOpen, setBellOpen] = useState(false);
  const engineDown = preflight !== null && sidecar !== null && !(preflight.ok && sidecar.available);

  /* Lo zero si mostra spento invece di sparire: un contatore che scompare
     costringe a chiedersi se il dato manchi o valga zero. `null` = non ancora
     noto, e allora non si scrive niente. */
  const counter = (r: RouteDef): { text: string; zero: boolean; warn: boolean } | null => {
    if (r.counter === 'tracks' && stats) {
      return { text: stats.tracks.toLocaleString(locale), zero: stats.tracks === 0, warn: false };
    }
    if (r.counter === 'issues') {
      const n = openIssueCount(health);
      return n === null ? null : { text: String(n), zero: n === 0, warn: n > 0 };
    }
    return null;
  };

  const item = (r: RouteDef) => {
    const active = route === r.id;
    const c = counter(r);
    const btn = (
      <button
        key={r.id}
        onClick={() => go(r.id)}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'flex w-full items-center gap-3 rounded-control px-3 py-2 text-left',
          'transition-colors duration-press [&_svg]:size-[18px] [&_svg]:shrink-0',
          collapsed && 'justify-center px-0',
          active ? 'bg-accent/15 text-ink-hi' : 'text-ink-mid hover:bg-surface-hover hover:text-ink-hi'
        )}
      >
        <span className={active ? 'text-accent' : 'text-ink-lo'}>{r.icon}</span>
        {!collapsed && (
          <>
            <span className="flex-1 truncate text-[14px]">{t(r.labelKey)}</span>
            {c && (
              <span
                className={cn(
                  'shrink-0 font-mono text-[11px] tabular-nums',
                  c.warn
                    ? 'rounded-full bg-warning/20 px-1.5 text-warning'
                    : c.zero
                      ? 'text-ink-disabled'
                      : 'text-ink-lo'
                )}
              >
                {c.text}
              </span>
            )}
          </>
        )}
      </button>
    );
    return collapsed ? (
      <Tooltip key={r.id} side="right" content={t(r.labelKey)}>
        {btn}
      </Tooltip>
    ) : (
      btn
    );
  };

  const iconBtn =
    'relative grid size-8 place-items-center rounded-control text-ink-lo transition-colors duration-press hover:bg-surface-hover hover:text-ink-hi [&_svg]:size-4';

  return (
    <aside
      className={cn(
        'flex shrink-0 flex-col border-r border-line-subtle bg-surface-1 transition-[width] duration-swap ease-swift',
        collapsed ? 'w-sidebar-collapsed' : 'w-[224px]'
      )}
    >
      <div className={cn('flex items-center gap-2.5 px-4 pb-4 pt-4', collapsed && 'justify-center px-0')}>
        <CrateTile size={24} radius={6} />
        {!collapsed && <span className="text-[15px] font-semibold tracking-tight text-ink-hi">CrateForge</span>}
      </div>

      <button
        onClick={onOpenPalette}
        className={cn(
          'mx-3 mb-4 flex h-9 items-center gap-2 rounded-control border border-line bg-surface-2 px-3',
          'text-caption text-ink-lo transition-colors duration-press hover:border-line-strong hover:text-ink-mid',
          collapsed && 'mx-2 justify-center px-0'
        )}
      >
        <Search className="size-4 shrink-0" />
        {!collapsed && (
          <>
            <span className="truncate text-body">{t('shell.search')}</span>
            <kbd className="ml-auto font-mono text-[10px] text-ink-lo">{shortcut('K')}</kbd>
          </>
        )}
      </button>

      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2">
        {ROUTES.filter((r) => !r.bottom).map(item)}
        <div className="mt-auto pt-2">{ROUTES.filter((r) => r.bottom).map(item)}</div>
      </nav>

      <div
        className={cn(
          'flex items-center gap-1 border-t border-line-subtle px-3 py-2.5',
          collapsed && 'flex-col px-0'
        )}
      >
        <Popover.Root open={bellOpen} onOpenChange={setBellOpen}>
          <Tooltip content={t('shell.notifications')}>
            <Popover.Trigger asChild>
              <button className={iconBtn} aria-label={t('shell.notifications')}>
                <Bell />
                {unread > 0 && (
                  <span className="absolute right-1 top-1 grid min-w-[14px] place-items-center rounded-full bg-accent px-1 font-mono text-[8.5px] font-bold leading-[14px] text-accent-ink">
                    {unread > 99 ? '99' : unread}
                  </span>
                )}
              </button>
            </Popover.Trigger>
          </Tooltip>
          <Popover.Portal>
            <Popover.Content
              side="right"
              align="end"
              sideOffset={10}
              className="z-50 w-[380px] overflow-hidden rounded-card border border-line bg-surface-2 shadow-e3 animate-scale-in"
            >
              <NotificationCenter />
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>

        <Tooltip content={t('shell.theme')}>
          <button
            className={iconBtn}
            aria-label={t('shell.theme')}
            onClick={() => setTheme(isDark ? 'light' : 'dark')}
          >
            {isDark ? <Sun /> : <Moon />}
          </button>
        </Tooltip>

        {engineDown ? (
          <Tooltip content={t('shell.engineDownTip')}>
            <button
              className={cn(iconBtn, 'text-warning hover:text-warning')}
              aria-label={t('shell.engineDown')}
              onClick={() => go('settings', 'about')}
            >
              <AlertTriangle />
            </button>
          </Tooltip>
        ) : (
          <Tooltip content={t('shell.safe')}>
            <span className={cn(iconBtn, 'cursor-default text-success hover:bg-transparent hover:text-success')}>
              <ShieldCheck />
            </span>
          </Tooltip>
        )}

        <Tooltip content={t(collapsed ? 'shell.expand' : 'shell.collapse')}>
          <button
            className={cn(iconBtn, !collapsed && 'ml-auto')}
            onClick={onToggleCollapse}
            aria-label={t(collapsed ? 'shell.expand' : 'shell.collapse')}
          >
            <ChevronsLeft className={cn('transition-transform duration-swap', collapsed && 'rotate-180')} />
          </button>
        </Tooltip>
      </div>
    </aside>
  );
}
