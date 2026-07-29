import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Database,
  ListMusic,
  Minus,
  Route,
  Search,
  Sparkles
} from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Eyebrow,
  StatTile
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Badge,
  EmptyState,
  Input,
  Notice,
  Segmented,
  Stepper,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger
} from '@/components/ui/misc';
import { DangerConfirmDialog } from '@/components/DangerConfirmDialog';
import { SaveTargetNotice, type SaveTarget } from '@/components/SaveTargetNotice';
import { RekordboxDiff } from '@/components/RekordboxDiff';
import { CamelotWheel } from '@/components/data/CamelotWheel';
import { useAppState } from '@/lib/appState';
import { useJobs } from '@/lib/jobs';
import { useNotifications } from '@/lib/notifications';
import { useRouter } from '@/lib/router';
import { pageText } from '@/lib/i18nPages';
import { formatDuration } from '@/lib/utils';

/**
 * Set (Esperto) — due funzioni che lavorano sulla stessa materia:
 *   Costruisci ← Set Builder (matematica dichiarata: key compatibili + curva BPM)
 *   Analizza   ← Set Planner (read-only: transizioni problematiche e ponti)
 */
export function SetsPage() {
  const { locale } = useAppState();
  const { tab, setTab } = useRouter();
  return (
    <Tabs value={tab ?? 'build'} onValueChange={setTab}>
      <TabsList>
        <TabsTrigger value="build">
          <Sparkles /> {pageText(locale, 'tabs', 'build')}
        </TabsTrigger>
        <TabsTrigger value="plan">
          <Route /> {pageText(locale, 'tabs', 'plan')}
        </TabsTrigger>
      </TabsList>
      <TabsContent value="build">
        <BuildTab />
      </TabsContent>
      <TabsContent value="plan">
        <PlanTab />
      </TabsContent>
    </Tabs>
  );
}

/* -------------------------------------------------------------- Costruisci */

interface TrackRow {
  id: number;
  title: string | null;
  artist: string | null;
  bpm: number | null;
  camelot: string | null;
}

interface SetTrack {
  id: number;
  title: string | null;
  artist: string | null;
  bpm: number;
  camelot: string;
  genre: string | null;
  duration_s: number | null;
}

interface BuildResult {
  tracks: SetTrack[];
  requested: number;
  exhausted: boolean;
  totalDurationS: number;
}

type Curve = 'up' | 'flat' | 'down';

function BuildTab() {
  const { locale } = useAppState();
  /* Tonalità scelta sulla ruota: parte da quella del brano iniziale e poi
     segue i clic dell'utente. */
  const [wheelKey, setWheelKey] = useState<string | null>(null);
  const tp = (k: string, p?: Record<string, string | number>) =>
    pageText(locale, 'setbuilder', k, p);
  const { run } = useJobs();
  const { push } = useNotifications();

  const [search, setSearch] = useState('');
  const [results, setResults] = useState<TrackRow[]>([]);
  const [start, setStart] = useState<TrackRow | null>(null);
  const [length, setLength] = useState(10);
  const [curve, setCurve] = useState<Curve>('up');
  const [built, setBuilt] = useState<BuildResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<{ text: string; target: SaveTarget } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [masterDbWrites, setMasterDbWrites] = useState(false);
  const [confirmMdb, setConfirmMdb] = useState(false);

  useEffect(() => {
    window.crateforge.settings.get('masterDbWrites').then((v) => setMasterDbWrites(v === '1'));
  }, []);

  const doSearch = async () => {
    const r = await window.crateforge.library.page({ offset: 0, limit: 20, search });
    setResults(r.rows);
  };

  const doBuild = async () => {
    if (!start) return;
    setError(null);
    setOutcome(null);
    setBusy(true);
    try {
      setBuilt(
        (await window.crateforge.setbuilder.build(start.id, length, curve)) as BuildResult
      );
    } catch (err) {
      setError(String(err));
      setBuilt(null);
    } finally {
      setBusy(false);
    }
  };

  const doExport = async () => {
    if (!built) return;
    const outPath = await window.crateforge.dialog.saveFile('crateforge-set.xml', [
      { name: 'Rekordbox XML', extensions: ['xml'] }
    ]);
    if (!outPath) return;
    const name = tp('plName');
    const r = await window.crateforge.setbuilder.exportXml(
      built.tracks.map((t) => t.id),
      name,
      outPath
    );
    const text = tp('outDone', { name, path: outPath, n: r.written });
    setOutcome({ text, target: 'xml' });
    push({ kind: 'success', title: tp('title'), body: text });
  };

  const doMasterdbWrite = async () => {
    if (!built) return;
    const rb = await window.crateforge.rekordbox.defaultPaths();
    const masterDbPath = await window.crateforge.dialog.openFile(
      [{ name: 'Rekordbox master.db', extensions: ['db'] }],
      rb.masterDbExists ? rb.masterDb : rb.dir
    );
    if (!masterDbPath) return;
    const optionsPath = await window.crateforge.dialog.openFile(
      [{ name: 'options.json', extensions: ['json'] }],
      rb.optionsJsonExists ? rb.optionsJson : rb.dir
    );
    const name = tp('plName');
    setError(null);
    setOutcome(null);
    setBusy(true);
    try {
      /* Non annullabile: qui si scrive dentro il database cifrato di
         Rekordbox. Interrompere a metà una transazione SQLCipher è il modo
         più diretto per lasciare la libreria in uno stato che nessuno sa
         rimettere a posto. */
      const r = await run(
        tp('mdbBtn'),
        () =>
          window.crateforge.masterdb.createPlaylist(
            built.tracks.map((t) => t.id),
            name,
            masterDbPath,
            optionsPath
          ),
        { cancellable: false }
      );
      if (!r.ok) {
        setError(tp('mdbErr', { msg: r.message ?? '?' }));
      } else {
        const text = tp('mdbOutDone', {
          name,
          n: r.added,
          missing: r.missing,
          dir: r.backupDir
        });
        setOutcome({ text, target: 'masterdb' });
        push({ kind: 'warning', job: true, title: tp('title'), body: text });
      }
    } catch (err) {
      setError(tp('mdbErr', { msg: String(err) }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <Notice variant="warning" title={tp('warnTitle')}>
        {tp('warnBody')}
      </Notice>
      <RekordboxDiff page="setbuilder" />

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <Card>
          <CardHeader>
            <CardTitle className="text-body font-semibold">{tp('step1')}</CardTitle>
            <CardDescription>{tp('step1Desc')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={tp('searchPh')}
                onKeyDown={(e) => e.key === 'Enter' && doSearch()}
              />
              <Button variant="secondary" onClick={doSearch}>
                <Search /> {tp('searchBtn')}
              </Button>
            </div>

            {results.length > 0 && (
              <div className="max-h-48 overflow-auto rounded-card border border-line-subtle">
                {results.map((tr) => {
                  const valid = !!tr.camelot && !!tr.bpm;
                  return (
                    <button
                      key={tr.id}
                      disabled={!valid}
                      onClick={() => {
                        setStart(tr);
                        setBuilt(null);
                        setOutcome(null);
                      }}
                      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-caption transition-colors duration-press hover:bg-surface-hover disabled:opacity-45 ${
                        start?.id === tr.id ? 'bg-accent/10 text-ink-hi' : 'text-ink-mid'
                      }`}
                    >
                      <span className="min-w-0 flex-1 truncate">
                        {tr.artist ?? '?'} — {tr.title ?? '?'}
                      </span>
                      <span className="shrink-0 font-mono tabular-nums text-ink-lo">
                        {valid ? `${Math.round(tr.bpm!)} · ${tr.camelot}` : tp('missingData')}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            <div className="flex flex-wrap items-end gap-4">
              <div className="space-y-1.5">
                <Eyebrow>{tp('lenLabel')}</Eyebrow>
                <Stepper
                  value={length}
                  onChange={setLength}
                  min={2}
                  max={60}
                  suffix={tp('lenUnit')}
                  label={tp('lenLabel')}
                />
              </div>
              <div className="space-y-1.5">
                <Eyebrow>{tp('curveLabel')}</Eyebrow>
                <Segmented
                  value={curve}
                  onChange={setCurve}
                  options={[
                    { value: 'up', label: tp('curveUp'), icon: <ArrowUp /> },
                    { value: 'flat', label: tp('curveFlat'), icon: <Minus /> },
                    { value: 'down', label: tp('curveDown'), icon: <ArrowDown /> }
                  ]}
                />
              </div>
              <Button variant="primary" onClick={doBuild} disabled={!start} working={busy}>
                <Sparkles /> {built ? tp('rebuildBtn') : tp('buildBtn')}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-body font-semibold">{tp('wheelTitle')}</CardTitle>
            <CardDescription>{tp('wheelDesc')}</CardDescription>
          </CardHeader>
          <CardContent>
            {/* La ruota è un controllo, non un disegno: cliccare una tonalità
                ri-centra l'insieme dei compatibili (§5.2). Senza `onChange` il
                componente restava inerte pur avendo già tutto il necessario. */}
            <CamelotWheel
              value={wheelKey ?? start?.camelot ?? null}
              onChange={setWheelKey}
              size={260}
            />
          </CardContent>
        </Card>
      </div>

      {built && (
        <Card>
          <CardHeader>
            <CardTitle className="text-body font-semibold">
              {tp('step2', {
                n: built.tracks.length,
                dur: formatDuration(built.totalDurationS)
              })}
            </CardTitle>
            {built.exhausted && <CardDescription>{tp('exhausted')}</CardDescription>}
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="max-h-96 overflow-auto rounded-card border border-line-subtle">
              {built.tracks.map((tr, i) => (
                <div
                  key={tr.id}
                  style={{ height: 'var(--row-h)', fontSize: 'var(--row-font)' }}
                  className="flex items-center gap-2.5 border-b border-line-subtle px-3 last:border-b-0"
                >
                  <span className="w-6 shrink-0 text-right font-mono tabular-nums text-ink-lo">
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-ink-hi">
                    {tr.artist ?? '?'} — {tr.title ?? '?'}
                  </span>
                  <span className="shrink-0 font-mono tabular-nums text-ink-mid">
                    {Math.round(tr.bpm)}
                  </span>
                  <span className="w-9 shrink-0 text-right font-mono tabular-nums text-accent">
                    {tr.camelot}
                  </span>
                  <span className="w-12 shrink-0 text-right font-mono tabular-nums text-ink-lo">
                    {formatDuration(tr.duration_s)}
                  </span>
                </div>
              ))}
            </div>

            <SaveTargetNotice target="xml" />

            <div className="flex flex-wrap gap-2">
              <Button variant="primary" onClick={doExport}>
                <ListMusic /> {tp('exportBtn')}
              </Button>
              {masterDbWrites && (
                <Button variant="destructive" onClick={() => setConfirmMdb(true)} disabled={busy}>
                  <Database /> {tp('mdbBtn')}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {outcome && (
        <div className="space-y-2">
          <Notice variant="success">{outcome.text}</Notice>
          <SaveTargetNotice target={outcome.target} />
        </div>
      )}
      {error && <Notice variant="destructive">{error}</Notice>}

      <DangerConfirmDialog
        open={confirmMdb}
        onOpenChange={setConfirmMdb}
        title={tp('mdbDlgTitle')}
        confirmWord="MASTERDB"
        confirmLabel={tp('mdbDlgLabel')}
        onConfirm={doMasterdbWrite}
        facts={[
          { label: tp('factPlaylist'), value: tp('plName') },
          { label: tp('factTracks'), value: (built?.tracks.length ?? 0).toLocaleString(locale) },
          { label: tp('factSnapshot'), value: tp('factSnapshotYes') },
          { label: tp('factRbOpen'), value: tp('factRbOpenWarn'), warn: true }
        ]}
        description={
          <>
            <p>{tp('mdbDlgBody1', { name: tp('plName'), n: built?.tracks.length ?? 0 })}</p>
            <p>{tp('mdbDlgBody2')}</p>
          </>
        }
      />
    </div>
  );
}

/* ----------------------------------------------------------------- Analizza */

interface PlannerTrack {
  id: number;
  title: string | null;
  artist: string | null;
  bpm: number | null;
  camelot: string | null;
}

interface Transition {
  from: PlannerTrack;
  to: PlannerTrack;
  flags: string[];
  keyOk: boolean | null;
  bpmDelta: number | null;
  bridges: PlannerTrack[];
}

interface Analysis {
  tracks: number;
  transitions: Transition[];
  problems: number;
  missingData: number;
}

function PlanTab() {
  const { locale } = useAppState();
  const tp = (k: string, p?: Record<string, string | number>) => pageText(locale, 'planner', k, p);
  const [playlists, setPlaylists] = useState<{ id: number; name: string; trackCount: number }[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    window.crateforge.planner.playlists().then(setPlaylists);
  }, []);

  const doAnalyze = async (id: number) => {
    setSelected(id);
    setBusy(true);
    try {
      setAnalysis((await window.crateforge.planner.analyze(id)) as Analysis);
    } finally {
      setBusy(false);
    }
  };

  const label = (t: PlannerTrack) => `${t.artist ?? '?'} — ${t.title ?? '?'}`;

  return (
    <div className="space-y-4">
      <Notice variant="warning" title={tp('warnTitle')}>
        {tp('warnBody')}
      </Notice>
      <RekordboxDiff page="planner" />

      <Card>
        <CardHeader>
          <CardTitle className="text-body font-semibold">{tp('step1')}</CardTitle>
          <CardDescription>{tp('step1Desc')}</CardDescription>
        </CardHeader>
        <CardContent>
          {playlists.length === 0 ? (
            <EmptyState title={tp('noPlaylistsTitle')}>{tp('noPlaylistsBody')}</EmptyState>
          ) : (
            <div className="flex flex-wrap gap-2">
              {playlists.map((p) => (
                <Button
                  key={p.id}
                  size="sm"
                  variant={selected === p.id ? 'primary' : 'secondary'}
                  onClick={() => doAnalyze(p.id)}
                >
                  {p.name}
                  <span className="font-mono text-caption tabular-nums opacity-70">
                    {p.trackCount}
                  </span>
                </Button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {analysis && (
        <Card>
          <CardHeader>
            <CardTitle className="text-body font-semibold">
              {tp('step2', { n: analysis.transitions.length, p: analysis.problems })}
            </CardTitle>
            <CardDescription>
              {analysis.missingData > 0 && tp('missingNote', { n: analysis.missingData })}{' '}
              {tp('bridgesNote')}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatTile label={tp('sTracks')} value={analysis.tracks.toLocaleString(locale)} />
              <StatTile
                label={tp('sTransitions')}
                value={analysis.transitions.length.toLocaleString(locale)}
              />
              <StatTile
                label={tp('sProblems')}
                value={analysis.problems.toLocaleString(locale)}
                tone={analysis.problems > 0 ? 'warning' : 'success'}
              />
              <StatTile
                label={tp('sMissing')}
                value={analysis.missingData.toLocaleString(locale)}
              />
            </div>

            <div className="max-h-[28rem] space-y-2 overflow-auto">
              {analysis.transitions.map((tr, i) => {
                const bad = tr.flags.includes('key-clash') || tr.flags.includes('bpm-jump');
                const missing =
                  tr.flags.includes('missing-key') || tr.flags.includes('missing-bpm');
                return (
                  <div
                    key={i}
                    className={`rounded-card border p-2.5 ${
                      bad ? 'border-warning/50 bg-warning/[.07]' : 'border-line-subtle'
                    }`}
                  >
                    <div className="flex items-center gap-2 text-caption">
                      <span className="w-12 shrink-0 font-mono tabular-nums text-ink-lo">
                        {String(i + 1).padStart(2, '0')}→{String(i + 2).padStart(2, '0')}
                      </span>
                      {bad && <AlertTriangle className="size-3.5 shrink-0 text-warning" />}
                      <span className="min-w-0 flex-1 truncate text-ink-hi">{label(tr.from)}</span>
                      <ArrowRight className="size-3 shrink-0 text-ink-lo" />
                      <span className="min-w-0 flex-1 truncate text-ink-hi">{label(tr.to)}</span>
                      <span className="shrink-0 font-mono tabular-nums text-accent">
                        {tr.from.camelot ?? '—'} → {tr.to.camelot ?? '—'}
                      </span>
                      <span className="shrink-0 font-mono tabular-nums text-ink-mid">
                        {tr.from.bpm ? Math.round(tr.from.bpm) : '—'} →{' '}
                        {tr.to.bpm ? Math.round(tr.to.bpm) : '—'}
                      </span>
                      {tr.keyOk === false ? (
                        <Badge variant="warning">{tp('keyClash')}</Badge>
                      ) : tr.bpmDelta !== null && tr.bpmDelta > 6 ? (
                        <Badge variant="warning">
                          {tp('bpmJump', { pct: tr.bpmDelta.toFixed(1) })}
                        </Badge>
                      ) : missing ? (
                        <Badge variant="neutral">{tp('missingData')}</Badge>
                      ) : (
                        <Badge variant="success">{tp('okLine')}</Badge>
                      )}
                    </div>

                    {tr.bridges.length > 0 && (
                      <div className="mt-2 border-t border-line-subtle pt-2">
                        <div className="mb-1 flex items-center gap-1.5 text-caption font-medium text-ink-mid">
                          <Route className="size-3" /> {tp('bridges')}
                        </div>
                        {tr.bridges.map((b) => (
                          <div key={b.id} className="truncate text-caption text-ink-lo">
                            • {label(b)}{' '}
                            <span className="font-mono tabular-nums">
                              {b.camelot ?? '—'} · {b.bpm ? Math.round(b.bpm) : '—'}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <p className="text-caption text-ink-lo">{tp('readOnlyNote')}</p>
          </CardContent>
        </Card>
      )}

      {busy && <p className="text-caption text-ink-lo">{tp('analyzing')}</p>}
    </div>
  );
}
