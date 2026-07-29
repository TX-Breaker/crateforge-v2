import { useEffect, useState } from 'react';
import {
  ArrowRight,
  BookOpen,
  Database,
  FileWarning,
  FolderOpen,
  Import,
  Music2,
  RefreshCw,
  Shuffle,
  Wand2
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Eyebrow, StatTile } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { EmptyState, Notice, Skeleton } from '@/components/ui/misc';
import { GuideDialog } from '@/components/GuideDialog';
import { BpmHistogram, CountUp, HealthRing, KeyCoverage } from '@/components/data/Charts';
import { useAppState } from '@/lib/appState';
import { useLibrary } from '@/lib/library';
import { useJobs } from '@/lib/jobs';
import { useNotifications } from '@/lib/notifications';
import { useRouter } from '@/lib/router';
import { pageText } from '@/lib/i18nPages';
import { formatClock, shortenPath } from '@/lib/utils';

interface Distribution {
  bpm: { bucket: number; count: number }[];
  camelot: { camelot: string; count: number }[];
  noKey: number;
  firstImport: string | null;
  lastImport: string | null;
}

/**
 * Panoramica. Deve rispondere a colpo d'occhio a una domanda sola: com'è messa
 * la mia libreria e cosa devo fare adesso.
 *
 * Le "azioni consigliate" sono derivate dal report di salute reale, non da un
 * elenco fisso: se non c'è niente da segnalare, la sezione non compare.
 */
export function OverviewPage() {
  const { locale } = useAppState();
  const tp = (k: string, p?: Record<string, string | number>) =>
    pageText(locale, 'overview', k, p);
  const { stats, health, empty, loading, refresh, xmlOnly, rbPaths, preflight, rerunPreflight } =
    useLibrary();
  const { run } = useJobs();
  const { push } = useNotifications();
  const { go } = useRouter();
  const [dist, setDist] = useState<Distribution | null>(null);
  const [guide, setGuide] = useState(false);
  const [pfBusy, setPfBusy] = useState(false);

  const loadDist = () => window.crateforge.library.distribution().then(setDist);
  useEffect(() => {
    loadDist();
  }, [stats?.tracks]);

  const afterImport = async (title: string, detail: string) => {
    await refresh();
    await loadDist();
    push({ kind: 'success', job: true, title, body: detail });
  };

  const importXml = async () => {
    const path = await window.crateforge.dialog.openFile([
      { name: 'Rekordbox collection XML', extensions: ['xml'] }
    ]);
    if (!path) return;
    try {
      const r = await run(tp('importXmlBtn'), () => window.crateforge.library.ingestXml(path));
      await afterImport(
        tp('importXmlBtn'),
        tp('xmlOk', { tracks: r.tracks, playlists: r.playlists, cues: r.cues })
      );
    } catch (err) {
      push({ kind: 'error', job: true, title: tp('importXmlBtn'), body: String(err) });
    }
  };

  const importMasterDb = async (explicitPath?: string) => {
    const dbPath =
      explicitPath ??
      (await window.crateforge.dialog.openFile(
        [{ name: 'Database Rekordbox', extensions: ['db'] }],
        rbPaths?.masterDbExists ? rbPaths.masterDb : rbPaths?.dir
      ));
    if (!dbPath) return;
    try {
      const r = await run(tp('importDbBtn'), () => window.crateforge.library.ingestMasterdb(dbPath));
      if (r.ok) await afterImport(tp('importDbBtn'), tp('masterOk'));
      else push({ kind: 'warning', job: true, title: tp('importDbBtn'), body: r.message });
    } catch (err) {
      push({ kind: 'error', job: true, title: tp('importDbBtn'), body: String(err) });
    }
  };

  const importForeign = async (kind: 'traktor' | 'virtualdj' | 'engine') => {
    const filter =
      kind === 'traktor'
        ? { name: 'Traktor collection', extensions: ['nml'] }
        : kind === 'engine'
          ? { name: 'Engine Library', extensions: ['db'] }
          : { name: 'VirtualDJ database', extensions: ['xml'] };
    const path = await window.crateforge.dialog.openFile([filter]);
    if (!path) return;
    const label = tp(
      kind === 'traktor' ? 'foreignTraktor' : kind === 'engine' ? 'foreignEngine' : 'foreignVirtualdj'
    );
    try {
      const r = await run(label, () => window.crateforge.library.importForeign(kind, path));
      if (r.ok) {
        await afterImport(
          label,
          tp('foreignOk', { tracks: r.tracks, playlists: r.playlists, cues: r.cues }) +
            (r.warnings?.length ? ` ${r.warnings.join(' ')}` : '')
        );
      } else {
        push({ kind: 'error', job: true, title: label, body: r.message });
      }
    } catch (err) {
      push({ kind: 'error', job: true, title: label, body: String(err) });
    }
  };

  const importSerato = async () => {
    const dir = await window.crateforge.dialog.openDirectory();
    if (!dir) return;
    try {
      const r = (await run(tp('foreignSerato'), () =>
        window.crateforge.library.importSerato(dir)
      )) as { ok: boolean; tracks?: number; playlists?: number; message?: string };
      if (r.ok) await afterImport(tp('foreignSerato'), tp('seratoOk', { tracks: r.tracks ?? 0 }));
      else push({ kind: 'error', job: true, title: tp('foreignSerato'), body: r.message ?? '' });
    } catch (err) {
      push({ kind: 'error', job: true, title: tp('foreignSerato'), body: String(err) });
    }
  };

  /* Azioni consigliate: numeri veri del report di salute, non un template. */
  const suggestions = health
    ? [
        health.withoutHotCues > 0 && {
          id: 'cues',
          icon: <Wand2 />,
          title: tp('sugCues'),
          body: tp('sugCuesBody', { n: health.withoutHotCues.toLocaleString(locale) }),
          go: () => go('enrich', 'cues')
        },
        health.needsReview > 0 && {
          id: 'review',
          icon: <FileWarning />,
          title: tp('sugReview'),
          body: tp('sugReviewBody', { n: health.needsReview.toLocaleString(locale) }),
          go: () => go('tracks', undefined, { filter: 'needsReview' })
        },
        health.duplicateTracks > 0 && {
          id: 'dup',
          icon: <Shuffle />,
          title: tp('sugDup'),
          body: tp('sugDupBody', {
            groups: health.duplicateGroups.toLocaleString(locale),
            tracks: health.duplicateTracks.toLocaleString(locale)
          }),
          go: () => go('cleanup', 'duplicates')
        },
        {
          id: 'backup',
          icon: <Database />,
          title: tp('sugBackup'),
          body: tp('sugBackupBody'),
          go: () => go('backup')
        }
      ].filter(Boolean as unknown as (v: unknown) => v is NonNullable<unknown>)
    : [];

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 w-full" />
        <div className="grid grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PreflightBanner
        onRetry={async () => {
          setPfBusy(true);
          try {
            await rerunPreflight();
          } finally {
            setPfBusy(false);
          }
        }}
        busy={pfBusy}
      />

      {xmlOnly && (
        <Notice
          variant="warning"
          title={tp('xmlOnlyTitle')}
          actions={
            <Button size="sm" variant="secondary" onClick={() => setGuide(true)}>
              <BookOpen /> {pageText(locale, 'guide', 'openExport')}
            </Button>
          }
        >
          {tp('xmlOnlyBody')}
        </Notice>
      )}

      {empty ? (
        <EmptyState
          icon={<Music2 />}
          title={tp('emptyTitle')}
          watermark
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button variant="primary" onClick={importXml}>
                <Import /> {tp('importXmlBtn')}
              </Button>
              <Button variant="secondary" onClick={() => importMasterDb()} disabled={xmlOnly}>
                <Database /> {tp('importDbBtn')}
              </Button>
            </div>
          }
        >
          {tp('emptyBody')}
        </EmptyState>
      ) : (
        <>
          {/* salute + statistiche */}
          <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
            <Card>
              <CardContent className="flex items-center gap-5 p-5">
                <HealthRing score={health?.score ?? 0} label={tp('scoreOutOf')} />
                <div className="min-w-0 space-y-1">
                  <Eyebrow>{tp('healthLabel')}</Eyebrow>
                  <div className="text-section text-ink-hi">
                    {(health?.score ?? 0) >= 85
                      ? tp('scoreGood')
                      : (health?.score ?? 0) >= 60
                        ? tp('scoreMid')
                        : tp('scoreBad')}
                  </div>
                  <p className="text-caption text-ink-mid">{tp('scoreHint')}</p>
                  <Button size="sm" variant="ghost" onClick={() => go('health')}>
                    {tp('openHealth')} <ArrowRight />
                  </Button>
                </div>
              </CardContent>
            </Card>

            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <StatTile
                icon={<Music2 />}
                label={tp('statTracks')}
                value={<CountUp value={stats?.tracks ?? 0} />}
                onClick={() => go('tracks')}
              />
              <StatTile
                icon={<FolderOpen />}
                label={tp('statPlaylists')}
                value={<CountUp value={stats?.playlists ?? 0} />}
              />
              <StatTile
                icon={<FileWarning />}
                label={tp('statReview')}
                tone={(stats?.needsReview ?? 0) > 0 ? 'warning' : 'neutral'}
                value={<CountUp value={stats?.needsReview ?? 0} />}
                note={(stats?.needsReview ?? 0) > 0 ? tp('statReviewNote') : undefined}
                onClick={() => go('tracks', undefined, { filter: 'needsReview' })}
              />
              <StatTile
                icon={<Wand2 />}
                label={tp('statNoCue')}
                value={<CountUp value={health?.withoutHotCues ?? 0} />}
                onClick={() => go('enrich', 'cues')}
              />
            </div>
          </div>

          {/* distribuzioni */}
          {dist && (dist.bpm.length > 0 || dist.camelot.length > 0) && (
            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="text-body font-semibold">{tp('bpmTitle')}</CardTitle>
                  <CardDescription>{tp('bpmDesc')}</CardDescription>
                </CardHeader>
                <CardContent>
                  {/* Cliccare una barra porta all'elenco già filtrato su quel
                      tempo: il grafico risponde "quanti", il click risponde
                      "quali", ed è sempre la seconda domanda. */}
                  <BpmHistogram
                    data={dist.bpm}
                    onSelect={(from, to) => go('tracks', undefined, { bpm: `${from}-${to}` })}
                  />
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="text-body font-semibold">{tp('keyTitle')}</CardTitle>
                  <CardDescription>
                    {tp('keyDesc', { n: dist.noKey.toLocaleString(locale) })}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <KeyCoverage
                    data={dist.camelot}
                    onSelect={(camelot) => go('tracks', undefined, { camelot })}
                  />
                </CardContent>
              </Card>
            </div>
          )}

          {/* cosa fare adesso */}
          {suggestions.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-body font-semibold">{tp('nextTitle')}</CardTitle>
                <CardDescription>{tp('nextDesc')}</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-2 sm:grid-cols-2">
                {(suggestions as { id: string; icon: React.ReactNode; title: string; body: string; go: () => void }[]).map(
                  (s) => (
                    <button
                      key={s.id}
                      onClick={s.go}
                      className="flex items-start gap-3 rounded-card border border-line-subtle bg-surface-3 px-3.5 py-3 text-left transition-colors duration-press hover:border-line-strong hover:bg-surface-hover"
                    >
                      <span className="mt-0.5 text-accent [&_svg]:size-4">{s.icon}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-body font-medium text-ink-hi">{s.title}</span>
                        <span className="block text-caption text-ink-mid">{s.body}</span>
                      </span>
                      <ArrowRight className="mt-0.5 size-3.5 shrink-0 text-ink-lo" />
                    </button>
                  )
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* import */}
      <Card>
        <CardHeader>
          <CardTitle className="text-body font-semibold">{tp('importTitle')}</CardTitle>
          <CardDescription>{tp('importDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={importXml}>
              <Import /> {tp('importXmlBtn')}
            </Button>
            <Button
              variant="secondary"
              onClick={() => importMasterDb(rbPaths?.masterDbExists ? rbPaths.masterDb : undefined)}
              disabled={xmlOnly}
            >
              <Database />{' '}
              {rbPaths?.masterDbExists ? tp('importDbDetected') : tp('importDbBtn')}
            </Button>
            <Button variant="ghost" onClick={() => setGuide(true)}>
              <BookOpen /> {pageText(locale, 'guide', 'openExport')}
            </Button>
          </div>
          {rbPaths?.masterDbExists && (
            <p className="text-caption text-ink-lo">
              {tp('masterDetectedAt', { path: shortenPath(rbPaths.masterDb, 60) })}{' '}
              <button
                type="button"
                onClick={() => importMasterDb()}
                disabled={xmlOnly}
                className="underline underline-offset-2 transition-colors duration-press hover:text-ink-hi disabled:opacity-50"
              >
                {tp('chooseOtherDb')}
              </button>
            </p>
          )}
          {stats?.lastIngest && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-card border border-line-subtle bg-surface-3 px-3 py-2">
              <Eyebrow>{tp('lastImport')}</Eyebrow>
              <span className="text-body text-ink-hi">{stats.lastIngest.source}</span>
              <span className="font-mono text-caption tabular-nums text-ink-lo">
                {formatClock(stats.lastIngest.finished_at)}
              </span>
              <span className="text-caption text-ink-mid">{stats.lastIngest.status}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* import da altri software */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-body font-semibold">
            <Shuffle className="size-4" /> {tp('foreignTitle')}
          </CardTitle>
          <CardDescription>{tp('foreignDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => importForeign('traktor')}>
            <Import /> {tp('foreignTraktor')}
          </Button>
          <Button variant="secondary" onClick={() => importForeign('virtualdj')}>
            <Import /> {tp('foreignVirtualdj')}
          </Button>
          <Button variant="secondary" onClick={() => importForeign('engine')}>
            <Import /> {tp('foreignEngine')}
          </Button>
          <Button variant="secondary" onClick={importSerato}>
            <Import /> {tp('foreignSerato')}
          </Button>
        </CardContent>
      </Card>

      <GuideDialog kind="exportXml" open={guide} onOpenChange={setGuide} />
    </div>
  );
}

/**
 * Banner del preflight: appare solo se qualcosa NON è pronto. Ad app in ordine
 * non mostra nulla, per non fare rumore.
 */
function PreflightBanner({ onRetry, busy }: { onRetry: () => void; busy: boolean }) {
  const { locale } = useAppState();
  const { preflight } = useLibrary();
  const tp = (k: string) => pageText(locale, 'overview', k);
  if (!preflight || preflight.ok) return null;
  if (!preflight.sidecar.available) return null; // già coperto dall'avviso solo-XML

  const sidecarBroken = preflight.sidecar.available && !preflight.sidecar.runs;
  const keyMissing = preflight.sidecar.runs && !preflight.key.ready;

  return (
    <Notice
      variant={sidecarBroken ? 'destructive' : 'warning'}
      title={tp('pfTitle')}
      actions={
        <Button size="sm" variant="secondary" onClick={onRetry} working={busy}>
          <RefreshCw /> {tp('pfRetry')}
        </Button>
      }
    >
      {sidecarBroken && <p>{preflight.os.changed ? tp('pfSidecarOsChanged') : tp('pfSidecarBroken')}</p>}
      {keyMissing && (
        <p>
          {tp('pfKeyMissing')}
          {preflight.key.message ? ` (${preflight.key.message})` : ''}
        </p>
      )}
    </Notice>
  );
}
