import { useState } from 'react';
import { Bell, Monitor, Moon, Sun } from 'lucide-react';
import * as Popover from '@radix-ui/react-popover';
import { cn } from '@/lib/utils';
import { useAppState, type Theme } from '@/lib/appState';
import { useRouter } from '@/lib/router';
import { useLibrary } from '@/lib/library';
import { t } from '@/lib/i18n';
import { ROUTE_BY_ID, GROUPS } from '@/app/routes';
import { NotificationCenter } from '@/components/NotificationCenter';
import { useNotifications } from '@/lib/notifications';
import { Tooltip } from '@/components/ui/misc';

/**
 * Topbar (§3, 54px): breadcrumb + titolo di pagina a sinistra; a destra la
 * dimensione della libreria, la campanella con il contatore dei non letti,
 * lo switch rapido di luminosità e il badge della modalità.
 */
export function Topbar() {
  const { locale, theme, setTheme, mode, isDark } = useAppState();
  const { route } = useRouter();
  const { stats } = useLibrary();
  const { unread } = useNotifications();
  const [bellOpen, setBellOpen] = useState(false);

  const def = ROUTE_BY_ID[route];
  const group = GROUPS.find((g) => g.id === def.group);

  const themes: { id: Theme; icon: React.ReactNode; label: string }[] = [
    { id: 'light', icon: <Sun />, label: t(locale, 'theme.light') },
    { id: 'dark', icon: <Moon />, label: t(locale, 'theme.dark') },
    { id: 'system', icon: <Monitor />, label: t(locale, 'theme.auto') }
  ];

  return (
    <header className="flex h-topbar shrink-0 items-center gap-4 border-b border-line-subtle bg-surface-1 px-6">
      <div className="min-w-0">
        <div className="font-mono text-[9.5px] uppercase tracking-[.14em] text-ink-lo">
          {group ? t(locale, group.labelKey) : ''} / {t(locale, def.labelKey)}
        </div>
        <h1 className="truncate text-[17px] font-semibold leading-6 tracking-[-.02em] text-ink-hi">
          {t(locale, def.labelKey)}
        </h1>
      </div>

      <div className="ml-auto flex items-center gap-3">
        {stats && (
          <div className="hidden items-baseline gap-1.5 md:flex">
            <span className="font-mono text-data tabular-nums text-ink-hi">
              {stats.tracks.toLocaleString(locale)}
            </span>
            <span className="text-caption text-ink-lo">{t(locale, 'common.tracks')}</span>
          </div>
        )}

        <Popover.Root open={bellOpen} onOpenChange={setBellOpen}>
          <Popover.Trigger asChild>
            <button
              className="relative grid size-8 place-items-center rounded-control text-ink-mid transition-colors duration-press hover:bg-surface-hover hover:text-ink-hi"
              aria-label={t(locale, 'notif.title')}
            >
              <Bell className="size-4" />
              {unread > 0 && (
                <span className="absolute right-1 top-1 grid min-w-[14px] place-items-center rounded-full bg-accent px-1 font-mono text-[8.5px] font-bold leading-[14px] text-accent-ink">
                  {unread > 99 ? '99' : unread}
                </span>
              )}
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              align="end"
              sideOffset={8}
              className="z-50 w-[380px] overflow-hidden rounded-card border border-line bg-surface-2 shadow-e3 animate-scale-in"
            >
              <NotificationCenter />
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>

        <div className="flex items-center gap-0.5 rounded-control border border-line bg-surface-3 p-0.5">
          {themes.map((th) => (
            <Tooltip key={th.id} content={th.label}>
              <button
                onClick={() => setTheme(th.id)}
                aria-pressed={theme === th.id}
                // Bottone di sola icona: senza aria-label resterebbe senza nome
                // accessibile, il tooltip non conta per la tastiera.
                aria-label={th.label}
                className={cn(
                  // 28x28 e' il bersaglio minimo (§4.1): a 24 il bottone del tema stava sotto.
                  'grid size-7 place-items-center rounded-[4px] transition-colors duration-press [&_svg]:size-3.5',
                  theme === th.id
                    ? 'bg-accent text-accent-ink'
                    : 'text-ink-lo hover:bg-surface-hover hover:text-ink-mid'
                )}
              >
                {th.icon}
              </button>
            </Tooltip>
          ))}
        </div>

        <span
          className={cn(
            'rounded-chip px-1.5 py-0.5 font-mono text-[9.5px] font-bold uppercase tracking-[.1em]',
            mode === 'expert' ? 'bg-warning/20 text-warning' : 'bg-surface-3 text-ink-lo'
          )}
          title={isDark ? t(locale, 'theme.dark') : t(locale, 'theme.light')}
        >
          {t(locale, mode === 'expert' ? 'mode.expert' : 'mode.simple')}
        </span>
      </div>
    </header>
  );
}
