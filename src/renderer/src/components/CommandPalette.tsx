import { useEffect, useMemo, useState } from 'react';
import { Command } from 'cmdk';
import {
  ArrowRight,
  Import,
  Languages,
  Lock,
  Moon,
  Rows3,
  Search,
  Sun,
  Wand2
} from 'lucide-react';
import { cn, formatDuration } from '@/lib/utils';
import { useAppState } from '@/lib/appState';
import { useRouter } from '@/lib/router';
import { useLibrary } from '@/lib/library';
import { useJobs } from '@/lib/jobs';
import { useNotifications } from '@/lib/notifications';
import { t } from '@/lib/i18n';
import { GROUPS, ROUTE_BY_ID, visibleRoutes } from '@/app/routes';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';

interface TrackHit {
  id: number;
  title: string | null;
  artist: string | null;
  bpm: number | null;
  camelot: string | null;
  duration_s: number | null;
}

/**
 * Palette comandi (§4.9). Navigazione, ricerca tracce con debounce e azioni
 * rapide in un'unica lista.
 *
 * REGOLA DI SICUREZZA, non negoziabile: nessun comando distruttivo è
 * eseguibile da qui. Le voci pericolose compaiono marcate e disabilitate;
 * selezionarle apre la pagina con il suo flusso di conferma intatto. Nessuna
 * sequenza di tasti può mettere in quarantena, cancellare o scrivere nel
 * master.db.
 */
export function CommandPalette({
  open,
  onOpenChange
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { locale, mode, setMode, theme, setTheme, themeStyle, setThemeStyle, density, setDensity } =
    useAppState();
  const { go } = useRouter();
  const { refresh, stats } = useLibrary();
  const { run } = useJobs();
  const { push } = useNotifications();
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<TrackHit[]>([]);
  const expert = mode === 'expert';

  // Ricerca tracce con debounce: la palette non deve martellare l'UDM a ogni
  // tasto premuto.
  useEffect(() => {
    if (!open || query.trim().length < 2) {
      setHits([]);
      return;
    }
    const handle = setTimeout(async () => {
      const r = (await window.crateforge.library.page({
        offset: 0,
        limit: 6,
        search: query.trim()
      })) as { rows: TrackHit[] };
      setHits(r.rows ?? []);
    }, 180);
    return () => clearTimeout(handle);
  }, [query, open]);

  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  const close = () => onOpenChange(false);

  const navigate = (route: Parameters<typeof go>[0], tab?: string, params?: Record<string, string>) => {
    go(route, tab, params);
    close();
  };

  const importXml = async () => {
    close();
    const path = await window.crateforge.dialog.openFile([
      { name: 'Rekordbox collection XML', extensions: ['xml'] }
    ]);
    if (!path) return;
    try {
      const r = await run(t(locale, 'action.importXml'), () =>
        window.crateforge.library.ingestXml(path)
      );
      await refresh();
      push({
        kind: 'success',
        job: true,
        title: t(locale, 'action.importXml'),
        body: `${r.tracks} · ${r.playlists} · ${r.cues}`
      });
    } catch (err) {
      push({ kind: 'error', job: true, title: t(locale, 'action.importXml'), body: String(err) });
    }
  };

  const actions = useMemo(
    () => [
      {
        id: 'import-xml',
        label: t(locale, 'action.importXml'),
        hint: t(locale, 'action.importXmlHint'),
        icon: <Import />,
        run: importXml
      },
      {
        id: 'backup',
        label: t(locale, 'action.planBackup'),
        hint: t(locale, 'action.dryRun'),
        icon: <ArrowRight />,
        run: () => navigate('backup')
      },
      {
        id: 'report',
        label: t(locale, 'action.excelReport'),
        icon: <ArrowRight />,
        run: () => navigate('reports', 'excel')
      },
      {
        id: 'theme',
        label: t(locale, theme === 'dark' ? 'action.themeLight' : 'action.themeDark'),
        icon: theme === 'dark' ? <Sun /> : <Moon />,
        run: () => {
          setTheme(theme === 'dark' ? 'light' : 'dark');
          close();
        }
      },
      {
        id: 'style',
        // Ciclo a tre, non interruttore: con un ternario da OLED non si sarebbe
        // più usciti se non dalle impostazioni.
        label: t(
          locale,
          themeStyle === 'studio'
            ? 'action.styleNeutral'
            : themeStyle === 'neutral'
              ? 'action.styleOled'
              : 'action.styleStudio'
        ),
        icon: <Wand2 />,
        run: () => {
          setThemeStyle(
            themeStyle === 'studio' ? 'neutral' : themeStyle === 'neutral' ? 'oled' : 'studio'
          );
          close();
        }
      },
      {
        id: 'density',
        label: t(locale, density === 'comfortable' ? 'action.densityCompact' : 'action.densityComfortable'),
        icon: <Rows3 />,
        run: () => {
          setDensity(density === 'comfortable' ? 'compact' : 'comfortable');
          close();
        }
      },
      {
        id: 'expert',
        label: t(locale, expert ? 'action.expertOff' : 'action.expertOn'),
        icon: <Wand2 />,
        run: () => {
          setMode(expert ? 'simple' : 'expert');
          close();
        }
      },
      {
        id: 'lang',
        label: t(locale, 'action.language'),
        icon: <Languages />,
        run: () => navigate('settings', 'general')
      }
    ],
    [locale, theme, themeStyle, density, expert]
  );

  /* Voci distruttive: presenti, marcate, MAI eseguibili da qui. */
  const guarded = [
    {
      id: 'quarantine',
      label: t(locale, 'action.quarantine'),
      route: 'cleanup' as const,
      tab: 'orphans'
    },
    { id: 'masterdb', label: t(locale, 'action.writeMasterDb'), route: 'sets' as const, tab: 'build' }
  ].filter(() => expert || true);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        hideClose
        className="max-w-2xl gap-0 overflow-hidden p-0 cf-glass"
        aria-describedby={undefined}
      >
        <DialogTitle className="sr-only">{t(locale, 'palette.title')}</DialogTitle>
        <Command
          shouldFilter
          filter={(value, search) =>
            value.toLowerCase().includes(search.toLowerCase()) ? 1 : 0
          }
          className="flex max-h-[60vh] flex-col"
        >
          <div className="flex items-center gap-2.5 border-b border-line-subtle px-4">
            <Search className="size-4 shrink-0 text-ink-lo" />
            <Command.Input
              autoFocus
              value={query}
              onValueChange={setQuery}
              placeholder={t(locale, 'palette.placeholder')}
              className="h-12 flex-1 bg-transparent text-body text-ink-hi outline-none placeholder:text-ink-lo"
            />
            <kbd className="rounded-[3px] border border-line px-1.5 py-0.5 font-mono text-[9.5px] text-ink-lo">
              ESC
            </kbd>
          </div>

          <Command.List className="min-h-0 flex-1 overflow-y-auto p-2">
            <Command.Empty className="px-3 py-8 text-center text-caption text-ink-lo">
              {t(locale, 'palette.noResults')}
            </Command.Empty>

            <Command.Group
              heading={
                <span className="px-2 font-mono text-[9.5px] uppercase tracking-[.14em] text-ink-lo">
                  {t(locale, 'palette.goTo')}
                </span>
              }
            >
              {visibleRoutes(expert).map((r) => {
                const group = GROUPS.find((g) => g.id === r.group);
                return (
                  <Command.Item
                    key={r.id}
                    value={`${t(locale, r.labelKey)} ${group ? t(locale, group.labelKey) : ''}`}
                    onSelect={() => navigate(r.id)}
                    className="flex cursor-pointer items-center gap-2.5 rounded-control px-2.5 py-2 text-body text-ink-mid data-[selected=true]:bg-surface-hover data-[selected=true]:text-ink-hi [&_svg]:size-4"
                  >
                    <span className="text-ink-lo">{r.icon}</span>
                    {t(locale, r.labelKey)}
                    <span className="ml-auto text-caption text-ink-lo">
                      {group ? t(locale, group.labelKey) : ''}
                    </span>
                  </Command.Item>
                );
              })}
            </Command.Group>

            <Command.Group
              heading={
                <span className="px-2 font-mono text-[9.5px] uppercase tracking-[.14em] text-ink-lo">
                  {t(locale, 'palette.actions')}
                </span>
              }
            >
              {actions.map((a) => (
                <Command.Item
                  key={a.id}
                  value={a.label}
                  onSelect={a.run}
                  className="flex cursor-pointer items-center gap-2.5 rounded-control px-2.5 py-2 text-body text-ink-mid data-[selected=true]:bg-surface-hover data-[selected=true]:text-ink-hi [&_svg]:size-4"
                >
                  <span className="text-ink-lo">{a.icon}</span>
                  {a.label}
                  {a.hint && <span className="ml-auto text-caption text-ink-lo">{a.hint}</span>}
                </Command.Item>
              ))}

              {guarded.map((g) => (
                <Command.Item
                  key={g.id}
                  value={g.label}
                  onSelect={() => navigate(g.route, g.tab)}
                  className="flex cursor-pointer items-center gap-2.5 rounded-control px-2.5 py-2 text-body text-ink-lo data-[selected=true]:bg-surface-hover [&_svg]:size-4"
                >
                  <Lock className="text-destructive" />
                  <span className="line-clamp-1">{g.label}</span>
                  <span className="ml-auto shrink-0 text-caption text-destructive">
                    {t(locale, 'palette.opensPage')}
                  </span>
                </Command.Item>
              ))}
            </Command.Group>

            {hits.length > 0 && (
              <Command.Group
                heading={
                  <span className="px-2 font-mono text-[9.5px] uppercase tracking-[.14em] text-ink-lo">
                    {t(locale, 'palette.tracks')} · {hits.length}
                    {stats ? ` / ${stats.tracks.toLocaleString(locale)}` : ''}
                  </span>
                }
              >
                {hits.map((h) => (
                  <Command.Item
                    key={h.id}
                    value={`${h.artist ?? ''} ${h.title ?? ''} ${h.id}`}
                    onSelect={() => navigate('tracks', undefined, { search: query.trim() })}
                    className="flex cursor-pointer items-center gap-2.5 rounded-control px-2.5 py-2 text-body text-ink-mid data-[selected=true]:bg-surface-hover data-[selected=true]:text-ink-hi"
                  >
                    <span
                      className={cn(
                        'w-8 shrink-0 rounded-chip bg-surface-3 py-0.5 text-center font-mono text-[10px] tabular-nums',
                        h.camelot ? 'text-accent' : 'text-ink-lo'
                      )}
                    >
                      {h.camelot ?? '—'}
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      {h.artist ?? '?'} — {h.title ?? '?'}
                    </span>
                    <span className="shrink-0 font-mono text-caption tabular-nums text-ink-lo">
                      {h.bpm ? h.bpm.toFixed(1) : '—'} · {formatDuration(h.duration_s)}
                    </span>
                  </Command.Item>
                ))}
              </Command.Group>
            )}
          </Command.List>

          <div className="border-t border-line-subtle px-4 py-2 text-caption text-ink-lo">
            {t(locale, 'palette.footer')}
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
