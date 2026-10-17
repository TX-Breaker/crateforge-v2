import { useCallback, useEffect, useState } from 'react';
import { Music2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState, Notice, Select } from '@/components/ui/misc';
import { Figure, PageHeader, Section } from '@/components/ui/page';
import { BpmHistogram, KeyCoverage } from '@/components/data/Charts';
import { CamelotWheel } from '@/components/data/CamelotWheel';
import { TrackList, type TrackFilter, type TrackScope } from '@/components/data/TrackList';
import { useAppState } from '@/lib/appState';
import { useLibrary } from '@/lib/library';
import { useNotifications } from '@/lib/notifications';
import { useRouter } from '@/lib/router';
import { openIssueCount } from '@/lib/issues';
import { useT } from '@/lib/strings';
import { SOFTWARE, SOFTWARE_LABEL, useWorkspace, type Scope } from '@/lib/workspace';
import { cn } from '@/lib/utils';
import { ImportMenu } from './library/importers';

/**
 * Libreria: che cosa ho.
 *
 * Una schermata sola dall'alto in basso: quattro numeri, i grafici di tempo e
 * tonalità con la ruota di Camelot, i brani nuovi se ce ne sono, e l'elenco.
 * I grafici e la ruota non sono decorazione: un clic filtra l'elenco sotto.
 */

const FILTERS: TrackFilter[] = ['needsReview', 'noKey', 'noBpm', 'noGenre'];
const isFilter = (v: string | undefined): v is TrackFilter => !!v && (FILTERS as string[]).includes(v);

interface Distribution {
  bpm: { bucket: number; count: number }[];
  camelot: { camelot: string; count: number }[];
  noKey: number;
}

interface InboxItem {
  id: number;
  title: string | null;
  artist: string | null;
  bpm: number | null;
  camelot: string | null;
  has_tag_issues: number;
}

export function LibraryScreen() {
  const t = useT();
  const { locale } = useAppState();
  const { stats, health, empty, refreshArrivals } = useLibrary();
  const { scope, choose, counts, refreshCounts } = useWorkspace();
  const { push } = useNotifications();
  const { go, params } = useRouter();

  const [dist, setDist] = useState<Distribution | null>(null);
  const [search, setSearch] = useState(params?.search ?? '');
  const [filters, setFilters] = useState<Set<TrackFilter>>(
    new Set(isFilter(params?.filter) ? [params!.filter as TrackFilter] : [])
  );
  const [trackScope, setTrackScope] = useState<TrackScope | undefined>(
    params?.camelot ? { camelot: params.camelot } : undefined
  );
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [inbox, setInbox] = useState<InboxItem[]>([]);
  const [inboxSel, setInboxSel] = useState<Set<number>>(new Set());

  useEffect(() => {
    void window.crateforge.library.distribution().then((d) => setDist(d as Distribution));
  }, [stats?.tracks]);

  /* Arrivo da un'altra schermata con un filtro già deciso (per esempio "brani
     da revisionare" da Da sistemare): lo si applica qui. */
  useEffect(() => {
    if (isFilter(params?.filter)) setFilters(new Set([params!.filter as TrackFilter]));
    if (params?.camelot) setTrackScope({ camelot: params.camelot });
  }, [params?.filter, params?.camelot]);

  const loadInbox = useCallback(async () => {
    const list = ((await window.crateforge.inbox.list('new')) as InboxItem[]) ?? [];
    setInbox(list);
    setInboxSel(new Set(list.filter((i) => i.has_tag_issues === 0).map((i) => i.id)));
  }, []);
  useEffect(() => {
    void loadInbox();
    return window.crateforge.watcher.onNewItems(() => void loadInbox());
  }, [loadInbox]);

  const issues = openIssueCount(health);
  const n = (v: number) => v.toLocaleString(locale);

  if (empty && stats) {
    return (
      <EmptyState icon={<Music2 />} title={t('lib.empty.title')} action={<ImportMenu />}>
        {t('lib.empty.body')}
      </EmptyState>
    );
  }

  const prepareInbox = async () => {
    const out = await window.crateforge.dialog.saveFile('crateforge-new-tracks.xml', [
      { name: 'Rekordbox XML', extensions: ['xml'] }
    ]);
    if (!out) return;
    const r = (await window.crateforge.inbox.prepareXml([...inboxSel], out)) as { written: number };
    push({ kind: 'success', title: t('lib.new.prepared', { n: r.written }), body: out });
    await loadInbox();
    await refreshArrivals();
  };

  const dismissInbox = async () => {
    const k = inboxSel.size;
    await window.crateforge.inbox.setStatus([...inboxSel], 'dismissed');
    push({ kind: 'info', title: t('lib.new.dismissed', { n: k }) });
    await loadInbox();
    await refreshArrivals();
  };

  /* Librerie importate prima che l'identità si collegasse da sola dopo ogni
     import: lo stesso brano compare una volta per programma finché non si
     collegano. Si propone solo quando è vero. */
  const withTracks = counts ? Object.values(counts.bySoftware).filter((x) => x.tracks > 0).length : 0;
  const needsLink = scope === 'all' && !!counts && withTracks > 1 && counts.unified.shared === 0;
  const link = async () => {
    const r = await window.crateforge.library.linkIdentity();
    push({ kind: 'success', title: t('lib.link.done', { n: n(r.linked) }) });
    await refreshCounts();
  };

  const exportSelection = async () => {
    const out = await window.crateforge.dialog.saveFile('crateforge-selection.xml', [
      { name: 'Rekordbox XML', extensions: ['xml'] }
    ]);
    if (!out) return;
    const r = (await window.crateforge.setbuilder.exportXml([...selected], t('lib.sel.playlist'), out)) as {
      written?: number;
    };
    push({ kind: 'success', title: t('lib.sel.exported', { n: r?.written ?? selected.size }), body: out });
  };

  const toggleFilter = (f: TrackFilter) =>
    setFilters((prev) => {
      const next = new Set(prev);
      if (next.has(f)) next.delete(f);
      else next.add(f);
      return next;
    });

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('nav.library')}
        aside={stats ? t('lib.summary', { tracks: n(stats.tracks), playlists: n(stats.playlists) }) : null}
      >
        <Select
          className="min-w-[200px]"
          value={scope}
          label={t('lib.allLibraries')}
          onValueChange={(v) => choose(v as Scope, 'ask')}
          options={[
            { value: 'all', label: t('lib.allLibraries') },
            ...SOFTWARE.map((s) => ({ value: s, label: SOFTWARE_LABEL[s] }))
          ]}
        />
        <ImportMenu />
      </PageHeader>

      {needsLink && (
        <Notice
          variant="info"
          actions={
            <Button size="sm" variant="secondary" onClick={link}>
              {t('lib.link.action')}
            </Button>
          }
        >
          {t('lib.link.hint')}
        </Notice>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Figure value={stats ? n(stats.tracks) : '—'} label={t('lib.fig.tracks')} />
        <Figure value={stats ? n(stats.playlists) : '—'} label={t('lib.fig.playlists')} />
        <Figure
          value={issues === null ? '—' : issues}
          label={issues === 0 ? t('lib.fig.issuesNone') : t('lib.fig.issues')}
          tone={issues ? 'warning' : issues === 0 ? 'good' : 'default'}
          onClick={() => go('fix')}
        />
        <Figure
          value={n(inbox.length)}
          label={t('lib.fig.new')}
          onClick={inbox.length ? () => document.getElementById('cf-inbox')?.scrollIntoView({ behavior: 'smooth' }) : undefined}
        />
      </div>

      {dist && (
        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
          <Section title={t('lib.bpm')} tip={t('lib.chartTip')}>
            <BpmHistogram
              data={dist.bpm}
              onSelect={(from, to) => setTrackScope({ bpmMin: from, bpmMax: to })}
            />
          </Section>
          <Section
            title={t('lib.key')}
            tip={t('lib.chartTip')}
            actions={
              dist.noKey > 0 ? (
                <span className="text-caption text-ink-lo">{t('lib.keyNone', { n: n(dist.noKey) })}</span>
              ) : undefined
            }
          >
            <KeyCoverage data={dist.camelot} onSelect={(camelot) => setTrackScope({ camelot })} />
          </Section>
          <Section title={t('lib.wheel')} tip={t('lib.wheelTip')} className="flex flex-col items-center">
            <CamelotWheel
              size={220}
              value={trackScope?.camelot ?? null}
              onChange={(camelot) => setTrackScope({ camelot })}
              emphasis={trackScope?.camelot ? 'compatible' : 'all'}
            />
          </Section>
        </div>
      )}

      {inbox.length > 0 && (
        <div id="cf-inbox">
          <Section
            title={`${t('lib.new.title')} · ${n(inbox.length)}`}
            tip={t('lib.new.tip')}
            actions={
              <>
                <Button size="sm" variant="ghost" disabled={inboxSel.size === 0} onClick={dismissInbox}>
                  {t('lib.new.dismiss')}
                </Button>
                <Button size="sm" variant="primary" disabled={inboxSel.size === 0} onClick={prepareInbox}>
                  {t('lib.new.prepare')}
                </Button>
              </>
            }
          >
            <ul className="divide-y divide-line-subtle">
              {inbox.slice(0, 50).map((i) => {
                const on = inboxSel.has(i.id);
                return (
                  <li key={i.id}>
                    <label className="flex cursor-pointer items-center gap-3 py-2">
                      <input
                        type="checkbox"
                        className="size-4 accent-[var(--accent)]"
                        checked={on}
                        onChange={() =>
                          setInboxSel((s) => {
                            const next = new Set(s);
                            if (next.has(i.id)) next.delete(i.id);
                            else next.add(i.id);
                            return next;
                          })
                        }
                      />
                      <span className="min-w-0 flex-1 truncate text-body text-ink-hi">
                        {[i.artist, i.title].filter(Boolean).join(' — ') || '—'}
                      </span>
                      {i.has_tag_issues ? (
                        <span className="text-caption text-warning">{t('lib.new.badTags')}</span>
                      ) : null}
                      <span className="w-14 text-right font-mono text-caption tabular-nums text-ink-lo">
                        {i.bpm ? i.bpm.toFixed(0) : '—'}
                      </span>
                      <span className={cn('w-10 text-right font-mono text-caption', i.camelot ? 'text-ink-mid' : 'text-ink-lo')}>
                        {i.camelot ?? '—'}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </Section>
        </div>
      )}

      <TrackList
        search={search}
        onSearchChange={setSearch}
        filters={filters}
        onToggleFilter={toggleFilter}
        scope={trackScope}
        onClearScope={() => setTrackScope(undefined)}
        selected={selected}
        onSelectedChange={setSelected}
        height={560}
        emptyState={
          <EmptyState
            title={t('lib.noMatch')}
            action={
              <Button
                variant="secondary"
                onClick={() => {
                  setSearch('');
                  setFilters(new Set());
                  setTrackScope(undefined);
                }}
              >
                {t('lib.clearFilters')}
              </Button>
            }
          />
        }
        bulkActions={
          <Button size="sm" variant="secondary" onClick={exportSelection}>
            {t('lib.sel.export')}
          </Button>
        }
      />
    </div>
  );
}
