import { useEffect, useState } from 'react';
import { Command } from 'cmdk';
import { ArrowRight, Keyboard, Languages, Lock, Moon, Sun } from 'lucide-react';
import { cn, formatDuration } from '@/lib/utils';
import { useAppState } from '@/lib/appState';
import { useRouter } from '@/lib/router';
import { useLibrary } from '@/lib/library';
import { useT, type StrKey } from '@/lib/strings';
import { ROUTES, type RouteId } from '@/app/routes';
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
 * Palette comandi: schermate, brani e azioni rapide in un'unica lista.
 *
 * REGOLA DI SICUREZZA, non negoziabile: nessun comando che modifica file è
 * eseguibile da qui. Le voci pericolose compaiono marcate e aprono la loro
 * schermata, dove la conferma resta intatta. Nessuna sequenza di tasti può
 * mettere in quarantena, cancellare o scrivere nel database di Rekordbox.
 */
export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const t = useT();
  const { locale, theme, setTheme } = useAppState();
  const { go } = useRouter();
  const { stats } = useLibrary();
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<TrackHit[]>([]);

  // Ricerca con debounce: la palette non deve interrogare l'archivio a ogni tasto.
  useEffect(() => {
    if (!open || query.trim().length < 2) {
      setHits([]);
      return;
    }
    const handle = setTimeout(async () => {
      const r = (await window.crateforge.library.page({ offset: 0, limit: 6, search: query.trim() })) as {
        rows: TrackHit[];
      };
      setHits(r.rows ?? []);
    }, 180);
    return () => clearTimeout(handle);
  }, [query, open]);

  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  const close = () => onOpenChange(false);
  const navigate = (route: RouteId, tab?: string, params?: Record<string, string>) => {
    go(route, tab, params);
    close();
  };

  const actions: { id: string; label: string; icon: React.ReactNode; hint?: string; run: () => void }[] = [
    { id: 'import', label: t('lib.import'), icon: <ArrowRight />, run: () => navigate('library') },
    { id: 'backup', label: t('bak.run'), icon: <ArrowRight />, run: () => navigate('backup') },
    { id: 'excel', label: t('rep.excelMake'), icon: <ArrowRight />, run: () => navigate('reports', 'excel') },
    {
      id: 'theme',
      label: t(theme === 'dark' ? 'action.themeLight' : 'action.themeDark'),
      icon: theme === 'dark' ? <Sun /> : <Moon />,
      run: () => {
        setTheme(theme === 'dark' ? 'light' : 'dark');
        close();
      }
    },
    {
      id: 'shortcuts',
      label: t('shortcut.title'),
      hint: '?',
      icon: <Keyboard />,
      run: () => {
        close();
        window.dispatchEvent(new Event('crateforge:shortcuts'));
      }
    },
    { id: 'lang', label: t('st.language'), icon: <Languages />, run: () => navigate('settings', 'general') }
  ];

  /* Voci che modificano file: presenti, marcate, MAI eseguibili da qui. */
  const guarded: { id: string; label: StrKey; route: RouteId; tab?: string }[] = [
    { id: 'orphans', label: 'fix.t.orphans', route: 'fix' },
    { id: 'masterdb', label: 'set.toRb', route: 'sets', tab: 'build' }
  ];

  const itemCls =
    'flex cursor-pointer items-center gap-2.5 rounded-control px-2.5 py-2 text-body text-ink-mid data-[selected=true]:bg-surface-hover data-[selected=true]:text-ink-hi [&_svg]:size-4';
  const heading = (text: string) => (
    <span className="px-2 font-mono text-[9.5px] uppercase tracking-[.14em] text-ink-lo">{text}</span>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent hideClose className="max-w-2xl gap-0 overflow-hidden p-0 cf-glass" aria-describedby={undefined}>
        <DialogTitle className="sr-only">{t('palette.title')}</DialogTitle>
        <Command
          shouldFilter
          filter={(value, search) => (value.toLowerCase().includes(search.toLowerCase()) ? 1 : 0)}
          className="flex max-h-[60vh] flex-col"
        >
          <div className="flex items-center gap-2.5 border-b border-line-subtle px-4">
            <Command.Input
              autoFocus
              value={query}
              onValueChange={setQuery}
              placeholder={t('palette.placeholder')}
              className="h-12 flex-1 bg-transparent text-body text-ink-hi outline-none placeholder:text-ink-lo"
            />
            <kbd className="rounded-[3px] border border-line px-1.5 py-0.5 font-mono text-[9.5px] text-ink-lo">ESC</kbd>
          </div>

          <Command.List className="min-h-0 flex-1 overflow-y-auto p-2">
            <Command.Empty className="px-3 py-8 text-center text-caption text-ink-lo">{t('palette.noResults')}</Command.Empty>

            <Command.Group heading={heading(t('palette.goTo'))}>
              {ROUTES.map((r) => (
                <Command.Item key={r.id} value={t(r.labelKey)} onSelect={() => navigate(r.id)} className={itemCls}>
                  <span className="text-ink-lo">{r.icon}</span>
                  {t(r.labelKey)}
                </Command.Item>
              ))}
            </Command.Group>

            <Command.Group heading={heading(t('palette.actions'))}>
              {actions.map((a) => (
                <Command.Item key={a.id} value={a.label} onSelect={a.run} className={itemCls}>
                  <span className="text-ink-lo">{a.icon}</span>
                  {a.label}
                  {a.hint && <span className="ml-auto text-caption text-ink-lo">{a.hint}</span>}
                </Command.Item>
              ))}
              {guarded.map((g) => (
                <Command.Item
                  key={g.id}
                  value={t(g.label)}
                  onSelect={() => navigate(g.route, g.tab)}
                  className={cn(itemCls, 'text-ink-lo')}
                >
                  <Lock className="text-destructive" />
                  <span className="line-clamp-1">{t(g.label)}</span>
                  <span className="ml-auto shrink-0 text-caption text-destructive">{t('palette.opensPage')}</span>
                </Command.Item>
              ))}
            </Command.Group>

            {hits.length > 0 && (
              <Command.Group
                heading={heading(
                  `${t('palette.tracks')} · ${hits.length}${stats ? ` / ${stats.tracks.toLocaleString(locale)}` : ''}`
                )}
              >
                {hits.map((h) => (
                  <Command.Item
                    key={h.id}
                    value={`${h.artist ?? ''} ${h.title ?? ''} ${h.id}`}
                    onSelect={() => navigate('library', undefined, { search: query.trim() })}
                    className={itemCls}
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

          <div className="border-t border-line-subtle px-4 py-2 text-caption text-ink-lo">{t('palette.footer')}</div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
