import { useEffect, useState } from 'react';
import { ArrowRightLeft, FolderOutput, ListMusic } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox, Notice, Segmented } from '@/components/ui/misc';
import { Disclosure, InfoTip, Section } from '@/components/ui/page';
import { DangerConfirmDialog } from '@/components/DangerConfirmDialog';
import { useAppState } from '@/lib/appState';
import { useJobs } from '@/lib/jobs';
import { useNotifications } from '@/lib/notifications';
import { useRouter } from '@/lib/router';
import { useT } from '@/lib/strings';
import { SOFTWARE_LABEL, SOURCES_OF, type SoftwareId, type SourceCounts } from '@/lib/workspace';
import type { From } from '../SyncScreen';

/**
 * Conversione una tantum. Un pulsante per la destinazione scelta, uno per
 * tutti i programmi trovati; il resto sta in «Opzioni».
 *
 * Serato è il caso diverso: non c'è un file da salvare, gli hot cue vanno
 * DENTRO i file audio. Passa quindi dal gate delle scritture dirette, dalla
 * prova a vuoto che conta i file e dalla parola chiave — come prima.
 */

type CueMode = 'fill' | 'overwrite';

interface SyncPlan {
  tracks: number;
  filled: number;
  replaced: number;
  demoted: number;
  lost: number;
}

interface BeatshiftPreview {
  tracks: number;
  cues: number;
  shiftedCues: number;
  byCase: Record<string, number>;
  shifts: { ms: number; cues: number }[];
}

interface ExportResult {
  ok?: boolean;
  tracks?: number;
  warnings?: string[];
  message?: string;
}

const FILE_FORMATS: Partial<Record<SoftwareId, { name: string; ext: string; file: string }>> = {
  rekordbox: { name: 'Rekordbox XML', ext: 'xml', file: 'crateforge-rekordbox.xml' },
  traktor: { name: 'Traktor NML', ext: 'nml', file: 'crateforge-traktor.nml' },
  virtualdj: { name: 'VirtualDJ XML', ext: 'xml', file: 'crateforge-virtualdj.xml' }
};

export function ConvertPanel({ from, to, counts }: { from: From; to: SoftwareId | null; counts: SourceCounts | null }) {
  const t = useT();
  const { locale } = useAppState();
  const { run } = useJobs();
  const { push } = useNotifications();
  const { go } = useRouter();
  const [cueMode, setCueMode] = useState<CueMode>('fill');
  const [beatshift, setBeatshift] = useState(false);
  const [bs, setBs] = useState<BeatshiftPreview | null>(null);
  const [plan, setPlan] = useState<SyncPlan | null>(null);
  const [directWrites, setDirectWrites] = useState(false);
  const [seratoPlan, setSeratoPlan] = useState<{ files: number; cues: number; loops: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void window.crateforge.settings.get('directWrites').then((v) => setDirectWrites(v === '1'));
  }, []);

  /** La sorgente dei brani: la prima presente fra quelle del software. */
  const source =
    from === 'all'
      ? undefined
      : SOURCES_OF[from].find((s) => counts?.bySoftware[from]?.sources.includes(s)) ?? SOURCES_OF[from][0];
  const destHasData = !!to && (counts?.bySoftware[to]?.tracks ?? 0) > 0;
  const sync =
    from !== 'all' && to && to !== 'serato'
      ? { originSources: SOURCES_OF[from], destination: to, mode: cueMode }
      : undefined;

  useEffect(() => {
    setError(null);
    if (!sync || !destHasData) {
      setPlan(null);
      return;
    }
    let alive = true;
    window.crateforge.sync
      .plan({ originSources: sync.originSources, destinationSources: SOURCES_OF[sync.destination], destination: sync.destination, mode: cueMode })
      .then((p) => alive && setPlan(p))
      .catch(() => alive && setPlan(null));
    return () => {
      alive = false;
    };
  }, [from, to, cueMode, destHasData]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!beatshift || !to) {
      setBs(null);
      return;
    }
    let alive = true;
    window.crateforge.exporter
      .beatshiftPreview(to, source ? { source } : undefined)
      .then((r) => alive && setBs(r.ok ? (r as unknown as BeatshiftPreview) : null))
      .catch(() => alive && setBs(null));
    return () => {
      alive = false;
    };
  }, [beatshift, to, source]);

  const report = (name: string, r: ExportResult, path?: string) => {
    if (r.ok === false) {
      push({ kind: 'error', job: true, title: t('sync.failed', { name }), body: r.message });
      return;
    }
    const warn = r.warnings?.length ? `\n${r.warnings.slice(0, 5).join('\n')}` : '';
    push({
      kind: r.warnings?.length ? 'warning' : 'success',
      job: true,
      title: t('sync.done', { name, n: (r.tracks ?? 0).toLocaleString(locale) }),
      body: `${path ?? ''}${warn}`.trim() || undefined
    });
  };

  const guarded = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const convert = () =>
    guarded(async () => {
      if (!to) return;
      const name = SOFTWARE_LABEL[to];
      const sel = { source, sync, beatshift };
      const fmt = FILE_FORMATS[to];
      if (fmt) {
        const out = (await window.crateforge.dialog.saveFile(fmt.file, [{ name: fmt.name, extensions: [fmt.ext] }])) as string | null;
        if (!out) return;
        const r = (await run(t('sync.convert', { name }), () =>
          to === 'rekordbox'
            ? window.crateforge.exporter.rekordboxXml(out, sel)
            : to === 'traktor'
              ? window.crateforge.exporter.traktorNml(out, sel)
              : window.crateforge.exporter.virtualdjXml(out, sel)
        )) as ExportResult;
        report(name, r, out);
      } else if (to === 'engine') {
        const outDir = (await window.crateforge.dialog.openDirectory()) as string | null;
        if (!outDir) return;
        const template = (await window.crateforge.dialog.openFile([{ name: 'Engine DJ (m.db)', extensions: ['db'] }])) as string | null;
        if (!template) return;
        const r = await run(t('sync.convert', { name }), () =>
          window.crateforge.exporter.engineLibrary(outDir, template, sel as never)
        );
        report(name, r, r.dbPath);
      } else if (to === 'serato') {
        const r = await window.crateforge.exporter.seratoCues({ ...(source ? { source } : {}), dryRun: true, beatshift });
        if (!r.ok) setError(r.message ?? t('c.error'));
        else setSeratoPlan({ files: r.files ?? 0, cues: r.cues ?? 0, loops: r.loops ?? 0 });
      }
    });

  const writeSerato = () =>
    guarded(async () => {
      /* Non annullabile di proposito: il ripristino vive nel sidecar e un
         processo terminato a forza non lo esegue. */
      const r = await run(
        t('sync.convert', { name: 'Serato' }),
        () => window.crateforge.exporter.seratoCues({ ...(source ? { source } : {}), beatshift }),
        { cancellable: false }
      );
      if (!r.ok) {
        push({ kind: 'error', job: true, title: t('sync.failed', { name: 'Serato' }), body: r.message });
        return;
      }
      push({ kind: 'success', job: true, title: t('sync.seratoDone', { n: r.written ?? 0 }), body: r.backupDir });
    });

  const seratoCrates = () =>
    guarded(async () => {
      const dir = (await window.crateforge.dialog.openDirectory()) as string | null;
      if (!dir) return;
      const r = await run(t('sync.seratoCrates'), () => window.crateforge.exporter.seratoCrates(dir));
      if (!r.ok) push({ kind: 'error', job: true, title: t('sync.failed', { name: 'Serato' }), body: r.message });
      else push({ kind: 'success', job: true, title: t('sync.seratoCratesDone', { n: r.written ?? 0 }), body: r.skipped?.join(', ') });
    });

  const toAll = () =>
    guarded(async () => {
      const dir = (await window.crateforge.dialog.openDirectory()) as string | null;
      if (!dir) return;
      const r = await run(t('sync.toAll'), () =>
        window.crateforge.exportAll(dir, {
          source,
          sync: from !== 'all' ? { originSources: SOURCES_OF[from], mode: cueMode } : undefined,
          beatshift
        })
      );
      const ok = r.results.filter((x) => x.ok);
      const problems = [
        ...r.results.filter((x) => !x.ok).map((x) => `${SOFTWARE_LABEL[x.id as SoftwareId] ?? x.id}: ${x.message ?? ''}`),
        ...ok.flatMap((x) => x.warnings ?? [])
      ];
      push({
        kind: problems.length ? 'warning' : 'success',
        job: true,
        title: t('sync.allDone', { n: ok.length }),
        body: [r.outDir, ...problems.slice(0, 5)].join('\n')
      });
    });

  if (!counts || Object.values(counts.bySoftware).every((s) => s.tracks === 0)) {
    return <Notice variant="info">{t('sync.nothing')}</Notice>;
  }

  const seratoBlocked = to === 'serato' && !directWrites;
  const n = (v: number) => v.toLocaleString(locale);

  return (
    <Section>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <Button size="lg" variant="primary" disabled={!to || busy || seratoBlocked} working={busy} onClick={convert}>
            <ArrowRightLeft /> {to ? t('sync.convert', { name: SOFTWARE_LABEL[to] }) : t('sync.pickTo')}
          </Button>
          {to === 'serato' && (
            <Button variant="secondary" disabled={busy} onClick={seratoCrates}>
              <ListMusic /> {t('sync.seratoCrates')}
            </Button>
          )}
          <span className="flex items-center gap-1">
            <Button variant="ghost" disabled={busy} onClick={toAll}>
              <FolderOutput /> {t('sync.toAll')}
            </Button>
            <InfoTip text={t('sync.toAllTip')} />
          </span>
        </div>

        {seratoBlocked && (
          <Notice
            variant="warning"
            actions={
              <Button size="sm" variant="secondary" onClick={() => go('settings', 'safety')}>
                {t('nav.settings')}
              </Button>
            }
          >
            {t('sync.seratoLocked')}
          </Notice>
        )}
        {to === 'engine' && <p className="text-caption text-ink-lo">{t('sync.engineNote')}</p>}
        {error && <Notice variant="destructive">{error}</Notice>}

        <Disclosure>
          {sync && destHasData && to && (
            <div className="space-y-1.5">
              <div className="text-caption text-ink-mid">{t('sync.cues', { name: SOFTWARE_LABEL[to] })}</div>
              <div className="flex flex-wrap items-center gap-3">
                <Segmented
                  size="sm"
                  value={cueMode}
                  onChange={setCueMode}
                  options={[
                    { value: 'fill', label: t('sync.cues.fill') },
                    { value: 'overwrite', label: t('sync.cues.overwrite'), tone: 'destructive' }
                  ]}
                />
                {plan && (
                  <span className={plan.lost > 0 ? 'text-caption text-warning' : 'text-caption text-ink-lo'}>
                    {t('sync.plan', { filled: n(plan.filled), replaced: n(plan.replaced), lost: n(plan.lost) })}
                  </span>
                )}
              </div>
            </div>
          )}
          <div className="space-y-1.5">
            <label className="flex cursor-pointer items-center gap-2.5 text-body text-ink-hi">
              <Checkbox checked={beatshift} onCheckedChange={(v) => setBeatshift(v === true)} />
              {t('sync.beatshift')}
              <InfoTip text={t('sync.beatshiftTip')} />
            </label>
            {beatshift && bs && (
              <div className="pl-7 text-caption">
                {bs.shiftedCues === 0 ? (
                  <span className="text-ink-lo">{t('sync.bs.none')}</span>
                ) : (
                  <>
                    <span className="text-ink-hi">
                      {t('sync.bs.summary', { shifted: n(bs.shiftedCues), cues: n(bs.cues) })}
                    </span>
                    <span className="ml-2 font-mono text-ink-lo">
                      {bs.shifts.map((s) => `${s.ms > 0 ? '+' : ''}${s.ms} ms × ${n(s.cues)}`).join(' · ')}
                    </span>
                    {(bs.byCase.unknown ?? 0) > 0 && (
                      <span className="block text-warning">{t('sync.bs.unknown', { n: n(bs.byCase.unknown) })}</span>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </Disclosure>
      </div>

      <DangerConfirmDialog
        open={seratoPlan !== null}
        onOpenChange={(o) => !o && setSeratoPlan(null)}
        title={t('sync.seratoTitle', { n: seratoPlan?.files ?? 0 })}
        description={t('sync.seratoBody')}
        facts={
          seratoPlan
            ? [
                { label: t('sync.f.files'), value: n(seratoPlan.files), warn: true },
                { label: t('sync.f.cues'), value: n(seratoPlan.cues) },
                { label: t('sync.f.loops'), value: n(seratoPlan.loops) },
                ...(beatshift && bs ? [{ label: t('sync.beatshift'), value: n(bs.shiftedCues) }] : [])
              ]
            : []
        }
        confirmWord="SCRIVI"
        confirmLabel={t('sync.seratoBtn')}
        onConfirm={() => {
          setSeratoPlan(null);
          void writeSerato();
        }}
      />
    </Section>
  );
}
