import { useEffect, useState } from 'react';
import { AlertTriangle, ArrowRight, Database, Minus, Save, Search, Sparkles, TrendingDown, TrendingUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox, EmptyState, Input, Notice, Segmented, Select, Stepper } from '@/components/ui/misc';
import { Figure, InfoTip, PageHeader, Section } from '@/components/ui/page';
import { CamelotWheel } from '@/components/data/CamelotWheel';
import { DangerConfirmDialog } from '@/components/DangerConfirmDialog';
import { useAppState } from '@/lib/appState';
import { useJobs } from '@/lib/jobs';
import { useNotifications } from '@/lib/notifications';
import { useRouter } from '@/lib/router';
import { useT } from '@/lib/strings';
import { cn, formatDuration } from '@/lib/utils';
import { trackName } from './fix/parts';

/**
 * Set: crearne uno a partire da un brano, o controllarne uno esistente.
 * La ruota di Camelot sta accanto alla scelta del brano iniziale: mostra le
 * tonalità compatibili e, con un clic, i brani in quella tonalità.
 */

interface TrackRow {
  id: number;
  title: string | null;
  artist: string | null;
  bpm: number | null;
  camelot: string | null;
}

interface SetTrack extends TrackRow {
  duration_s: number | null;
}

interface BuildResult {
  tracks: SetTrack[];
  requested: number;
  exhausted: boolean;
  totalDurationS: number;
}

type Curve = 'up' | 'flat' | 'down';

export function SetsScreen() {
  const t = useT();
  const { tab, setTab } = useRouter();
  const mode = tab === 'check' ? 'check' : 'build';
  return (
    <div className="space-y-6">
      <PageHeader title={t('nav.sets')}>
        <Segmented
          value={mode}
          onChange={(v) => setTab(v)}
          options={[
            { value: 'build', label: t('set.build') },
            { value: 'check', label: t('set.check') }
          ]}
        />
      </PageHeader>
      {mode === 'build' ? <Build /> : <Check />}
    </div>
  );
}

function Build() {
  const t = useT();
  const { run } = useJobs();
  const { push } = useNotifications();
  const [search, setSearch] = useState('');
  const [wheelKey, setWheelKey] = useState<string | null>(null);
  const [rows, setRows] = useState<TrackRow[]>([]);
  const [start, setStart] = useState<TrackRow | null>(null);
  const [length, setLength] = useState(12);
  const [curve, setCurve] = useState<Curve>('up');
  const [built, setBuilt] = useState<BuildResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [masterDbWrites, setMasterDbWrites] = useState(false);
  const [confirmMdb, setConfirmMdb] = useState(false);

  useEffect(() => {
    void window.crateforge.settings.get('masterDbWrites').then((v) => setMasterDbWrites(v === '1'));
    // Qualche brano già in elenco: si parte scegliendo, non da un campo vuoto.
    void find('', null);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const find = async (q: string, camelot: string | null) => {
    const r = (await window.crateforge.library.page({
      offset: 0,
      limit: 40,
      search: q || undefined,
      camelot: camelot ?? undefined
    })) as { rows: TrackRow[] };
    setRows(r.rows);
  };

  const pickKey = (k: string) => {
    setWheelKey(k);
    void find(search, k);
  };

  const create = async () => {
    if (!start) return;
    setBusy(true);
    setError(null);
    try {
      setBuilt((await window.crateforge.setbuilder.build(start.id, length, curve)) as BuildResult);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const saveXml = async () => {
    if (!built) return;
    const out = (await window.crateforge.dialog.saveFile('crateforge-set.xml', [
      { name: 'Rekordbox XML', extensions: ['xml'] }
    ])) as string | null;
    if (!out) return;
    const r = (await window.crateforge.setbuilder.exportXml(built.tracks.map((x) => x.id), t('set.plName'), out)) as {
      written: number;
    };
    push({ kind: 'success', title: t('set.saved', { n: r.written }), body: out });
  };

  const writeMasterDb = async () => {
    if (!built) return;
    const rb = await window.crateforge.rekordbox.defaultPaths();
    const db = (await window.crateforge.dialog.openFile(
      [{ name: 'Rekordbox master.db', extensions: ['db'] }],
      rb.masterDbExists ? rb.masterDb : rb.dir
    )) as string | null;
    if (!db) return;
    const options = (await window.crateforge.dialog.openFile(
      [{ name: 'options.json', extensions: ['json'] }],
      rb.optionsJsonExists ? rb.optionsJson : rb.dir
    )) as string | null;
    /* Non annullabile: interrompere una transazione nel database cifrato è il
       modo più diretto per lasciarlo in uno stato che nessuno sa ripristinare. */
    const r = (await run(
      t('set.toRb'),
      () => window.crateforge.masterdb.createPlaylist(built.tracks.map((x) => x.id), t('set.plName'), db, options),
      { cancellable: false }
    )) as { ok: boolean; message?: string; added: number; missing: number; backupDir?: string };
    if (!r.ok) setError(r.message ?? t('c.error'));
    else push({ kind: 'warning', job: true, title: t('set.mdbDone', { n: r.added, missing: r.missing }), body: r.backupDir });
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto]">
        <Section title={t('set.start')} tip={t('set.startTip')}>
          <div className="space-y-3">
            <div className="flex gap-2">
              <Input
                value={search}
                placeholder={t('cue.searchPh')}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void find(search, wheelKey)}
              />
              <Button variant="secondary" onClick={() => find(search, wheelKey)} aria-label={t('c.search')}>
                <Search />
              </Button>
            </div>
            {rows.length > 0 && (
              <div className="max-h-64 divide-y divide-line-subtle overflow-auto rounded-card border border-line-subtle">
                {rows.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => {
                      setStart(r);
                      if (r.camelot) setWheelKey(r.camelot);
                    }}
                    className={cn(
                      'flex w-full items-center gap-3 px-3 py-2 text-left transition-colors duration-press hover:bg-surface-hover',
                      start?.id === r.id && 'bg-accent/10'
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate text-body text-ink-hi">{trackName(r)}</span>
                    <span className="w-12 text-right font-mono text-caption text-ink-lo">{r.bpm ? Math.round(r.bpm) : '—'}</span>
                    <span className="w-8 text-right font-mono text-caption text-ink-mid">{r.camelot ?? '—'}</span>
                  </button>
                ))}
              </div>
            )}
            <div className="flex flex-wrap items-end gap-4 pt-1">
              <div className="space-y-1.5">
                <div className="text-caption text-ink-mid">{t('set.length')}</div>
                <Stepper value={length} onChange={setLength} min={3} max={60} label={t('set.length')} />
              </div>
              <div className="space-y-1.5">
                <div className="text-caption text-ink-mid">{t('set.energy')}</div>
                <Segmented
                  value={curve}
                  onChange={setCurve}
                  options={[
                    { value: 'up', label: t('set.up'), icon: <TrendingUp /> },
                    { value: 'flat', label: t('set.flat'), icon: <Minus /> },
                    { value: 'down', label: t('set.down'), icon: <TrendingDown /> }
                  ]}
                />
              </div>
              <Button size="lg" variant="primary" disabled={!start} working={busy} onClick={create}>
                <Sparkles /> {t('set.create')}
              </Button>
            </div>
          </div>
        </Section>
        <Section title={t('lib.wheel')} tip={t('lib.wheelTip')} className="flex flex-col items-center">
          <CamelotWheel size={240} value={wheelKey ?? start?.camelot ?? null} onChange={pickKey} />
        </Section>
      </div>

      {error && <Notice variant="destructive">{error}</Notice>}

      {built && (
        <Section
          title={t('set.summary', { n: built.tracks.length, duration: formatDuration(built.totalDurationS) })}
          actions={
            <>
              {masterDbWrites && (
                <Button size="sm" variant="ghost" onClick={() => setConfirmMdb(true)}>
                  <Database /> {t('set.toRb')}
                </Button>
              )}
              <Button size="sm" variant="primary" onClick={saveXml}>
                <Save /> {t('set.saveXml')}
              </Button>
            </>
          }
        >
          {built.exhausted && (
            <p className="mb-2 text-caption text-warning">{t('set.short', { n: built.tracks.length, req: built.requested })}</p>
          )}
          <ol className="divide-y divide-line-subtle">
            {built.tracks.map((x, i) => (
              <li key={x.id} className="flex items-center gap-3 py-1.5">
                <span className="w-6 font-mono text-caption tabular-nums text-ink-lo">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate text-body text-ink-hi">{trackName(x)}</span>
                <span className="w-12 text-right font-mono text-caption tabular-nums text-ink-mid">
                  {x.bpm ? x.bpm.toFixed(0) : '—'}
                </span>
                <span className="w-8 text-right font-mono text-caption text-accent">{x.camelot ?? '—'}</span>
                <span className="w-12 text-right font-mono text-caption tabular-nums text-ink-lo">
                  {formatDuration(x.duration_s)}
                </span>
              </li>
            ))}
          </ol>
        </Section>
      )}

      <DangerConfirmDialog
        open={confirmMdb}
        onOpenChange={setConfirmMdb}
        title={t('set.mdbTitle')}
        description={t('set.mdbBody')}
        facts={[{ label: t('c.tracks'), value: built?.tracks.length ?? 0 }]}
        confirmWord="MASTERDB"
        confirmLabel={t('set.mdbBtn')}
        onConfirm={() => void writeMasterDb()}
      />
    </div>
  );
}

interface PTrack {
  id: number;
  title: string | null;
  artist: string | null;
  bpm: number | null;
  camelot: string | null;
}

interface Transition {
  from: PTrack;
  to: PTrack;
  flags: string[];
  keyOk: boolean | null;
  bpmDelta: number | null;
  bridges: PTrack[];
}

interface Analysis {
  tracks: number;
  transitions: Transition[];
  problems: number;
  missingData: number;
}

function Check() {
  const t = useT();
  const { locale } = useAppState();
  const { go } = useRouter();
  const [playlists, setPlaylists] = useState<{ id: number; name: string; trackCount: number }[] | null>(null);
  const [selected, setSelected] = useState('');
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [onlyProblems, setOnlyProblems] = useState(true);

  useEffect(() => {
    void window.crateforge.planner.playlists().then(setPlaylists);
  }, []);

  const analyze = async (id: string) => {
    setSelected(id);
    setAnalysis((await window.crateforge.planner.analyze(Number(id))) as Analysis);
  };

  if (playlists && playlists.length === 0) {
    return (
      <EmptyState
        title={t('set.noPlaylists')}
        action={<Button variant="secondary" onClick={() => go('library')}>{t('lib.import')}</Button>}
      />
    );
  }

  const isBad = (tr: Transition) => tr.flags.includes('key-clash') || tr.flags.includes('bpm-jump');
  const shown = (analysis?.transitions ?? []).map((tr, i) => ({ tr, i })).filter(({ tr }) => !onlyProblems || isBad(tr));
  const n = (v: number) => v.toLocaleString(locale);

  return (
    <div className="space-y-5">
      <Select
        className="min-w-[280px]"
        value={selected}
        placeholder={t('set.pickPlaylist')}
        label={t('set.pickPlaylist')}
        onValueChange={analyze}
        options={(playlists ?? []).map((p) => ({ value: String(p.id), label: p.name, hint: String(p.trackCount) }))}
      />

      {analysis && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Figure value={n(analysis.tracks)} label={t('c.tracks')} />
            <Figure value={n(analysis.transitions.length)} label={t('set.transitions')} />
            <Figure value={n(analysis.problems)} label={t('set.problems')} tone={analysis.problems ? 'warning' : 'good'} />
            <Figure value={n(analysis.missingData)} label={t('set.missing')} />
          </div>
          <Section
            title={t('set.transitions')}
            actions={
              <label className="flex cursor-pointer items-center gap-2 text-caption text-ink-mid">
                <Checkbox checked={onlyProblems} onCheckedChange={(v) => setOnlyProblems(v === true)} />
                {t('set.onlyProblems')}
              </label>
            }
          >
            <ul className="space-y-2">
              {shown.map(({ tr, i }) => {
                const bad = isBad(tr);
                return (
                  <li
                    key={i}
                    className={cn('rounded-card border p-2.5', bad ? 'border-warning/50 bg-warning/[.07]' : 'border-line-subtle')}
                  >
                    <div className="flex items-center gap-2 text-caption">
                      <span className="w-12 shrink-0 font-mono tabular-nums text-ink-lo">
                        {i + 1}→{i + 2}
                      </span>
                      {bad && <AlertTriangle className="size-3.5 shrink-0 text-warning" />}
                      <span className="min-w-0 flex-1 truncate text-ink-hi">{trackName(tr.from)}</span>
                      <ArrowRight className="size-3 shrink-0 text-ink-lo" />
                      <span className="min-w-0 flex-1 truncate text-ink-hi">{trackName(tr.to)}</span>
                      <span className="shrink-0 font-mono text-accent">
                        {tr.from.camelot ?? '—'} → {tr.to.camelot ?? '—'}
                      </span>
                      <span className="w-40 shrink-0 text-right text-ink-mid">
                        {tr.keyOk === false
                          ? t('set.keyClash')
                          : tr.bpmDelta !== null && tr.bpmDelta > 6
                            ? t('set.bpmJump', { pct: tr.bpmDelta.toFixed(1) })
                            : tr.flags.some((f) => f.startsWith('missing'))
                              ? t('set.missing')
                              : t('set.ok')}
                      </span>
                    </div>
                    {tr.bridges.length > 0 && (
                      <div className="mt-1.5 pl-14 text-caption text-ink-lo">
                        {t('set.bridge')}:{' '}
                        {tr.bridges.map((b) => `${trackName(b)} (${b.camelot ?? '—'} · ${b.bpm ? Math.round(b.bpm) : '—'})`).join(' · ')}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </Section>
        </>
      )}
    </div>
  );
}
