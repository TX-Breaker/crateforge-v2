import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, Check, CircleAlert, Disc3, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Segmented } from '@/components/ui/misc';
import { ChoiceTile, Figure } from '@/components/ui/page';
import { CrateTile } from '@/components/Brand';
import { useAppState } from '@/lib/appState';
import { useJobs } from '@/lib/jobs';
import { useLibrary } from '@/lib/library';
import { useRouter } from '@/lib/router';
import { openIssueCount } from '@/lib/issues';
import { LOCALES, useT } from '@/lib/strings';
import { useWorkspace } from '@/lib/workspace';
import { cn } from '@/lib/utils';
import type { RouteId } from '@/app/routes';
import type { DjSoftware } from '@core/djVersions';
import type { DjSoftwareDetection } from '@core/djDetection';

/**
 * Primo avvio, in tre passi: quali programmi, importa, pronto.
 *
 * Prima erano cinque passi con un obiettivo da scegliere, una vetrina delle
 * funzioni, una diagnosi e le preferenze. Ora i programmi trovati sono già
 * spuntati, l'import parte con un pulsante e, se uno fallisce, si riprova o
 * si salta sulla sua riga — senza tornare indietro.
 */

const NAMES: Record<DjSoftware, string> = {
  rekordbox: 'Rekordbox',
  traktor: 'Traktor',
  virtualdj: 'VirtualDJ',
  serato: 'Serato DJ Pro 3',
  serato4: 'Serato DJ Pro 4',
  engine: 'Engine DJ'
};

type Step = 'pick' | 'import' | 'ready';
type RowState = { state: 'waiting' | 'working' | 'done' | 'failed' | 'skipped'; tracks?: number; message?: string };

const FILTERS: Record<DjSoftwareDetection['kind'], { name: string; extensions: string[] }[]> = {
  masterdb: [{ name: 'master.db', extensions: ['db'] }],
  nml: [{ name: 'collection.nml', extensions: ['nml'] }],
  vdjxml: [{ name: 'database.xml', extensions: ['xml'] }],
  enginedb: [{ name: 'Engine Library (m.db)', extensions: ['db'] }],
  serato4db: [{ name: 'Serato DJ Pro 4 (master.sqlite)', extensions: ['sqlite'] }],
  seratoDir: []
};

export function Welcome() {
  const t = useT();
  const { locale, setLocale, setOnboarded } = useAppState();
  const { run } = useJobs();
  const { refresh, stats, health } = useLibrary();
  const { refreshCounts } = useWorkspace();
  const { go } = useRouter();
  const [step, setStep] = useState<Step>('pick');
  const [detections, setDetections] = useState<DjSoftwareDetection[] | null>(null);
  const [chosen, setChosen] = useState<Set<DjSoftware>>(new Set());
  const [manual, setManual] = useState<Partial<Record<DjSoftware, string>>>({});
  const [wrong, setWrong] = useState<Partial<Record<DjSoftware, string>>>({});
  const [rows, setRows] = useState<Partial<Record<DjSoftware, RowState>>>({});

  useEffect(() => {
    void window.crateforge.detect
      .djSoftware()
      .then((d) => {
        setDetections(d);
        setChosen(new Set(d.filter((x) => x.found).map((x) => x.id)));
      })
      .catch(() => setDetections([]));
  }, []);

  const pathFor = (d: DjSoftwareDetection) => manual[d.id] ?? d.path;

  const browse = async (d: DjSoftwareDetection) => {
    const picked = (d.kind === 'seratoDir'
      ? await window.crateforge.dialog.openDirectory()
      : await window.crateforge.dialog.openFile(FILTERS[d.kind], d.hint.typicalPath)) as string | null;
    if (!picked) return;
    /* Il nome del file si controlla subito: è l'errore più comune (nella
       cartella di VirtualDJ l'unico .xml è `settings.xml`) e spiegarlo qui
       costa una riga, scoprirlo dopo costa un import fallito. */
    const base = picked.split(/[\\/]/).pop() ?? '';
    if (d.hint.fileName && base.toLowerCase() !== d.hint.fileName.toLowerCase()) {
      setWrong((w) => ({ ...w, [d.id]: d.hint.fileName! }));
      return;
    }
    setWrong((w) => ({ ...w, [d.id]: undefined }));
    setManual((m) => ({ ...m, [d.id]: picked }));
    setChosen((c) => new Set(c).add(d.id));
  };

  const importOne = useCallback(
    async (d: DjSoftwareDetection): Promise<RowState> => {
      const path = manual[d.id] ?? d.path;
      if (!path) return { state: 'failed', message: t('w.notFound') };
      try {
        const r = (await run(NAMES[d.id], async () => {
          switch (d.kind) {
            case 'masterdb':
              return window.crateforge.library.ingestMasterdb(path);
            case 'seratoDir':
              return window.crateforge.library.importSerato(path);
            case 'serato4db':
              return window.crateforge.library.importSerato4(path);
            case 'nml':
              return window.crateforge.library.importForeign('traktor', path);
            case 'vdjxml':
              return window.crateforge.library.importForeign('virtualdj', path);
            case 'enginedb':
              return window.crateforge.library.importForeign('engine', path);
          }
        })) as { ok: boolean; tracks?: number; message?: string } | undefined;
        if (!r) return { state: 'failed', message: d.kind };
        return r.ok ? { state: 'done', tracks: r.tracks } : { state: 'failed', message: r.message ?? t('c.error') };
      } catch (e) {
        return { state: 'failed', message: String(e) };
      }
    },
    [manual, run, t]
  );

  const list = (detections ?? []).filter((d) => chosen.has(d.id));

  const startImport = async () => {
    setStep('import');
    setRows(Object.fromEntries(list.map((d) => [d.id, { state: 'waiting' }])));
    for (const d of list) {
      setRows((r) => ({ ...r, [d.id]: { state: 'working' } }));
      const res = await importOne(d);
      setRows((r) => ({ ...r, [d.id]: res }));
    }
    await refresh();
    await refreshCounts();
  };

  const retry = async (d: DjSoftwareDetection) => {
    setRows((r) => ({ ...r, [d.id]: { state: 'working' } }));
    const res = await importOne(d);
    setRows((r) => ({ ...r, [d.id]: res }));
    await refresh();
    await refreshCounts();
  };

  const finish = (route: RouteId) => {
    setOnboarded(true);
    go(route);
  };

  const states = Object.values(rows);
  const settled = states.length > 0 && states.every((s) => s && (s.state === 'done' || s.state === 'skipped' || s.state === 'failed'));
  const blocked = states.some((s) => s?.state === 'failed');
  const issues = openIssueCount(health);

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-canvas">
      <div className="mx-auto w-full max-w-[760px] flex-1 px-8 py-12">
        <div className="flex items-center justify-between">
          <CrateTile size={40} radius={10} />
          <Segmented size="sm" value={locale} onChange={setLocale} options={LOCALES.map((l) => ({ value: l.id, label: l.id.toUpperCase() }))} />
        </div>

        <ol className="mt-8 flex items-center gap-2 text-caption">
          {(['pick', 'import', 'ready'] as Step[]).map((s, i) => (
            <li key={s} className="flex items-center gap-2">
              {i > 0 && <span className="h-px w-6 bg-line" />}
              <span className={cn(step === s ? 'text-ink-hi' : 'text-ink-lo')}>
                {i + 1}. {t(s === 'pick' ? 'w.step1' : s === 'import' ? 'w.step2' : 'w.step3')}
              </span>
            </li>
          ))}
        </ol>

        {step === 'pick' && (
          <section className="mt-6 space-y-6">
            <div>
              <h1 className="text-title text-ink-hi">{t('w.title')}</h1>
              <p className="mt-2 text-body text-ink-mid">{t('w.lead')}</p>
            </div>
            {detections === null ? (
              <p className="flex items-center gap-2 text-body text-ink-mid">
                <Loader2 className="size-4 animate-spin" /> {t('w.detecting')}
              </p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {detections.map((d) => {
                  const path = pathFor(d);
                  return (
                    <ChoiceTile
                      key={d.id}
                      selected={chosen.has(d.id)}
                      icon={<Disc3 />}
                      title={NAMES[d.id]}
                      hint={
                        wrong[d.id] ? (
                          <span className="text-warning">{t('w.wrongFile', { name: wrong[d.id]! })}</span>
                        ) : path ? (
                          t('w.found')
                        ) : (
                          t('w.notFound')
                        )
                      }
                      onClick={() => {
                        if (!path) {
                          void browse(d);
                          return;
                        }
                        setChosen((c) => {
                          const next = new Set(c);
                          if (next.has(d.id)) next.delete(d.id);
                          else next.add(d.id);
                          return next;
                        });
                      }}
                    />
                  );
                })}
              </div>
            )}
            <div className="flex items-center gap-3">
              <Button size="lg" variant="primary" disabled={list.length === 0} onClick={startImport}>
                {t('w.import', { n: list.length })} <ArrowRight />
              </Button>
              <Button variant="ghost" onClick={() => finish('library')}>
                {t('w.skip')}
              </Button>
            </div>
          </section>
        )}

        {step === 'import' && (
          <section className="mt-6 space-y-6">
            <h1 className="text-title text-ink-hi">{t('w.step2')}</h1>
            <ul className="divide-y divide-line-subtle rounded-card border border-line-subtle">
              {list.map((d) => {
                const r = rows[d.id] ?? { state: 'waiting' };
                return (
                  <li key={d.id} className="flex items-center gap-3 px-4 py-3">
                    <span className="w-5">
                      {r.state === 'working' && <Loader2 className="size-4 animate-spin text-accent" />}
                      {r.state === 'done' && <Check className="size-4 text-success" />}
                      {r.state === 'failed' && <CircleAlert className="size-4 text-destructive" />}
                    </span>
                    <span className="flex-1 text-body text-ink-hi">{NAMES[d.id]}</span>
                    <span className={cn('min-w-0 max-w-[50%] truncate text-caption', r.state === 'failed' ? 'text-destructive' : 'text-ink-mid')}>
                      {r.state === 'waiting' && t('w.waiting')}
                      {r.state === 'working' && t('w.importing')}
                      {r.state === 'done' && (r.tracks === undefined ? t('w.importedPlain') : t('w.done', { n: r.tracks.toLocaleString(locale) }))}
                      {r.state === 'skipped' && t('w.skipOne')}
                      {r.state === 'failed' && r.message}
                    </span>
                    {r.state === 'failed' && (
                      <>
                        <Button size="sm" variant="secondary" onClick={() => void retry(d)}>
                          <RefreshCw /> {t('c.retry')}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setRows((x) => ({ ...x, [d.id]: { state: 'skipped' } }))}>
                          {t('w.skipOne')}
                        </Button>
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
            <Button size="lg" variant="primary" disabled={!settled || blocked} onClick={() => setStep('ready')}>
              {t('w.continue')} <ArrowRight />
            </Button>
          </section>
        )}

        {step === 'ready' && (
          <section className="mt-6 space-y-6">
            <div>
              <h1 className="text-title text-ink-hi">{t('w.ready')}</h1>
              <p className="mt-2 text-body text-ink-mid">{t('w.readyLead')}</p>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Figure value={stats ? stats.tracks.toLocaleString(locale) : '—'} label={t('lib.fig.tracks')} />
              <Figure value={stats ? stats.playlists.toLocaleString(locale) : '—'} label={t('lib.fig.playlists')} />
              <Figure
                value={issues ?? '—'}
                label={issues === 0 ? t('lib.fig.issuesNone') : t('lib.fig.issues')}
                tone={issues ? 'warning' : issues === 0 ? 'good' : 'default'}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="lg" variant="primary" onClick={() => finish('library')}>
                {t('w.goLibrary')}
              </Button>
              {!!issues && (
                <Button size="lg" variant="secondary" onClick={() => finish('fix')}>
                  {t('w.goFix')}
                </Button>
              )}
              <Button size="lg" variant="ghost" onClick={() => finish('sync')}>
                {t('w.goSync')}
              </Button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
