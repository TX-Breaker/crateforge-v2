import { useEffect, useRef, useState } from 'react';
import {
  AudioLines,
  CheckCheck,
  Globe,
  ListMusic,
  Save,
  SaveAll,
  Search,
  Trash2,
  Wand2,
  XCircle
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
  Checkbox,
  EmptyState,
  Input,
  Notice,
  Segmented,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger
} from '@/components/ui/misc';
import { PathField } from '@/components/ui/fields';
import { DangerConfirmDialog } from '@/components/DangerConfirmDialog';
import { SaveTargetNotice, type SaveTarget } from '@/components/SaveTargetNotice';
import { RekordboxDiff } from '@/components/RekordboxDiff';
import { Waveform, type WaveCue } from '@/components/data/Waveform';
import { useAppState } from '@/lib/appState';
import { useJobs } from '@/lib/jobs';
import { useLibrary } from '@/lib/library';
import { useNotifications } from '@/lib/notifications';
import { useRouter } from '@/lib/router';
import { pageText } from '@/lib/i18nPages';
import { formatDuration } from '@/lib/utils';

/**
 * Arricchisci (Esperto) — tre funzioni sperimentali che rispondono alla stessa
 * domanda ("cosa manca a questi brani?") e che in V1 erano tre voci di menu:
 *   Cue   ← Auto-Cue
 *   Tag   ← Auto-Tagger
 *   Stems ← Stems (Demucs)
 * Ognuna dichiara i propri limiti prima di partire; nessuna salva senza che
 * l'utente abbia rivisto la proposta.
 */
export function EnrichPage() {
  const { locale } = useAppState();
  const { tab, setTab } = useRouter();
  return (
    <Tabs value={tab ?? 'cues'} onValueChange={setTab}>
      <TabsList>
        <TabsTrigger value="cues">
          <Wand2 /> {pageText(locale, 'tabs', 'cues')}
        </TabsTrigger>
        <TabsTrigger value="tags">
          <Globe /> {pageText(locale, 'tabs', 'tags')}
        </TabsTrigger>
        <TabsTrigger value="stems">
          <AudioLines /> {pageText(locale, 'tabs', 'stems')}
        </TabsTrigger>
      </TabsList>
      <TabsContent value="cues">
        <CuesTab />
      </TabsContent>
      <TabsContent value="tags">
        <TagsTab />
      </TabsContent>
      <TabsContent value="stems">
        <StemsTab />
      </TabsContent>
    </Tabs>
  );
}

/* --------------------------------------------------------------------- Cue */

interface TrackRow {
  id: number;
  title: string | null;
  artist: string | null;
  path: string | null;
}

interface ProposedCue {
  label: string;
  positionMs: number;
  color: string | null;
}

interface TrackResult {
  track: TrackRow;
  cues: ProposedCue[];
  meta: string | null;
  error: string | null;
  saved: boolean;
  envelope: number[];
  durationS: number | null;
  bpm: number | null;
}

const PAGE_SIZE = 50;

function CuesTab() {
  const { locale } = useAppState();
  const tp = (k: string, p?: Record<string, string | number>) => pageText(locale, 'autocue', k, p);
  const tc = (k: string, p?: Record<string, string | number>) => pageText(locale, 'common', k, p);
  const { push } = useNotifications();
  const { refresh } = useLibrary();

  const [source, setSource] = useState<'search' | 'playlist'>('search');
  const [search, setSearch] = useState('');
  const [playlists, setPlaylists] = useState<{ id: number; name: string; trackCount: number }[]>([]);
  const [playlistId, setPlaylistId] = useState<number | null>(null);
  const [tracks, setTracks] = useState<TrackRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [enabled, setEnabled] = useState<Set<number>>(new Set());
  const [results, setResults] = useState<TrackResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [snap, setSnap] = useState(false);
  const cancelRef = useRef(false);
  const [batchNote, setBatchNote] = useState<string | null>(null);

  useEffect(() => {
    window.crateforge.planner.playlists().then(setPlaylists);
  }, []);

  const loadTracks = async (p = page) => {
    if (source === 'playlist' && playlistId !== null) {
      const r = await window.crateforge.library.pageByPlaylist(playlistId, p * PAGE_SIZE, PAGE_SIZE);
      setTracks(r.rows);
      setTotal(r.total);
      setEnabled(new Set(r.rows.filter((t: TrackRow) => t.path).map((t: TrackRow) => t.id)));
    } else {
      const r = await window.crateforge.library.page({
        offset: p * PAGE_SIZE,
        limit: PAGE_SIZE,
        search
      });
      setTracks(r.rows);
      setTotal(r.total);
    }
    setPage(p);
  };

  const doBatch = async () => {
    const chosen = tracks.filter((t) => enabled.has(t.id) && t.path);
    if (chosen.length === 0) return;
    setBusy(true);
    cancelRef.current = false;
    setBatchNote(null);
    setResults([]);
    const out: TrackResult[] = [];
    for (let i = 0; i < chosen.length; i++) {
      if (cancelRef.current) break;
      const t = chosen[i];
      setBatchNote(
        tp('analyzing', {
          i: i + 1,
          tot: chosen.length,
          track: `${t.artist ?? '?'} – ${t.title ?? '?'}`
        })
      );
      try {
        const r = await window.crateforge.cues.analyze(t.id);
        out.push(
          r.ok
            ? {
                track: t,
                cues: r.cues as ProposedCue[],
                meta: tp('metaLine', {
                  d: r.durationS,
                  bpm: r.bpm ? tp('metaBpm', { bpm: r.bpm }) : '',
                  backend: r.backend
                }),
                error: null,
                saved: false,
                envelope: (r.envelope as number[] | undefined) ?? [],
                durationS: (r.durationS as number | undefined) ?? null,
                bpm: (r.bpm as number | undefined) ?? null
              }
            : {
                track: t,
                cues: [],
                meta: null,
                error: r.message,
                saved: false,
                envelope: [],
                durationS: null,
                bpm: null
              }
        );
      } catch (err) {
        out.push({
          track: t,
          cues: [],
          meta: null,
          error: String(err),
          saved: false,
          envelope: [],
          durationS: null,
          bpm: null
        });
      }
      setResults([...out]);
    }
    setBatchNote(
      cancelRef.current
        ? tp('stoppedNote', { n: out.length, tot: chosen.length })
        : tp('doneNote', { n: out.length })
    );
    setBusy(false);
  };

  const updateCue = (ri: number, ci: number, patch: Partial<ProposedCue>) =>
    setResults((prev) =>
      prev.map((r, i) =>
        i === ri ? { ...r, cues: r.cues.map((c, j) => (j === ci ? { ...c, ...patch } : c)) } : r
      )
    );

  const removeCue = (ri: number, ci: number) =>
    setResults((prev) =>
      prev.map((r, i) => (i === ri ? { ...r, cues: r.cues.filter((_, j) => j !== ci) } : r))
    );

  const saveOne = async (ri: number) => {
    const r = results[ri];
    await window.crateforge.cues.save(r.track.id, r.cues);
    setResults((prev) => prev.map((x, i) => (i === ri ? { ...x, saved: true } : x)));
  };

  const saveAll = async () => {
    let n = 0;
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (!r.saved && !r.error && r.cues.length > 0) {
        await saveOne(i);
        n++;
      }
    }
    await refresh();
    push({ kind: 'success', job: true, title: tp('title'), body: tp('savedAll', { n }) });
  };

  const savedCount = results.filter((r) => r.saved).length;

  return (
    <div className="space-y-4">
      <Notice variant="warning" title={tp('warnTitle')}>
        {tp('warnBody')}
      </Notice>
      <RekordboxDiff page="autocue" />

      <Card>
        <CardHeader>
          <CardTitle className="text-body font-semibold">{tp('step1')}</CardTitle>
          <CardDescription>{tp('step1Desc')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Segmented
            value={source}
            onChange={(v) => {
              setSource(v);
              setTracks([]);
              setEnabled(new Set());
            }}
            options={[
              { value: 'search', label: tp('srcSearch'), icon: <Search /> },
              { value: 'playlist', label: tp('srcPlaylist'), icon: <ListMusic /> }
            ]}
          />

          {source === 'search' ? (
            <div className="flex gap-2">
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={tp('searchPh')}
                onKeyDown={(e) => e.key === 'Enter' && loadTracks(0)}
              />
              <Button variant="secondary" onClick={() => loadTracks(0)}>
                <Search /> {tp('searchBtn')}
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {playlists.map((p) => (
                <Button
                  key={p.id}
                  size="sm"
                  variant={playlistId === p.id ? 'primary' : 'secondary'}
                  onClick={() => {
                    setPlaylistId(p.id);
                    setTimeout(() => loadTracks(0), 0);
                  }}
                >
                  {p.name}
                  <span className="font-mono text-caption tabular-nums opacity-70">
                    {p.trackCount}
                  </span>
                </Button>
              ))}
            </div>
          )}

          {tracks.length > 0 && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    setEnabled(new Set(tracks.filter((t) => t.path).map((t) => t.id)))
                  }
                >
                  {tc('selectAll')}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEnabled(new Set())}>
                  {tc('deselectAll')}
                </Button>
                <span className="font-mono text-caption tabular-nums text-ink-lo">
                  {enabled.size} / {total.toLocaleString(locale)}
                </span>
              </div>

              <div className="max-h-56 overflow-auto rounded-card border border-line-subtle">
                {tracks.map((tr) => (
                  <label
                    key={tr.id}
                    className="flex cursor-pointer items-center gap-2.5 border-b border-line-subtle px-3 py-1.5 transition-colors duration-press last:border-b-0 hover:bg-surface-hover"
                  >
                    <Checkbox
                      disabled={!tr.path}
                      checked={enabled.has(tr.id)}
                      onCheckedChange={() =>
                        setEnabled((prev) => {
                          const next = new Set(prev);
                          next.has(tr.id) ? next.delete(tr.id) : next.add(tr.id);
                          return next;
                        })
                      }
                    />
                    <span className="min-w-0 flex-1 truncate text-caption text-ink-mid">
                      <span className="text-ink-hi">{tr.artist ?? '?'}</span> — {tr.title ?? '?'}
                    </span>
                    {!tr.path && <Badge variant="warning">{tp('noPath')}</Badge>}
                  </label>
                ))}
              </div>

              {total > PAGE_SIZE && (
                <div className="flex items-center gap-2 text-caption text-ink-lo">
                  <Button size="sm" variant="ghost" disabled={page === 0} onClick={() => loadTracks(page - 1)}>
                    {tc('prev')}
                  </Button>
                  {tc('pageOf', { p: page + 1, tot: Math.ceil(total / PAGE_SIZE) })}
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={(page + 1) * PAGE_SIZE >= total}
                    onClick={() => loadTracks(page + 1)}
                  >
                    {tc('next')}
                  </Button>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-3">
                <Button variant="primary" onClick={doBatch} disabled={enabled.size === 0} working={busy}>
                  <Wand2 /> {tp('analyzeBtn', { n: enabled.size })}
                </Button>
                {busy && (
                  <Button variant="ghost" onClick={() => (cancelRef.current = true)}>
                    <XCircle /> {tp('stopBtn')}
                  </Button>
                )}
                <label className="flex items-center gap-2 text-caption text-ink-mid">
                  <Switch checked={snap} onCheckedChange={setSnap} />
                  {tp('snapLabel')}
                </label>
              </div>
              {batchNote && <p className="text-caption text-ink-lo">{batchNote}</p>}
            </>
          )}
        </CardContent>
      </Card>

      {results.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-body font-semibold">
              {tp('step2', { saved: savedCount, tot: results.length })}
            </CardTitle>
            <CardDescription>{tp('step2Desc')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <SaveTargetNotice target="udm" />
            <Button
              variant="primary"
              onClick={saveAll}
              disabled={results.every((r) => r.saved || r.error || r.cues.length === 0)}
            >
              <SaveAll /> {tp('saveAllBtn')}
            </Button>

            {results.map((r, ri) => (
              <div key={r.track.id} className="space-y-2 rounded-card border border-line-subtle p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-body text-ink-hi">
                    {r.track.artist ?? '?'} — {r.track.title ?? '?'}
                  </span>
                  {r.saved && <Badge variant="success">{tp('savedBadge')}</Badge>}
                  {r.error && <Badge variant="destructive">{r.error}</Badge>}
                  {r.meta && <span className="text-caption text-ink-lo">{r.meta}</span>}
                </div>

                {r.envelope.length > 0 && r.durationS && (
                  <Waveform
                    envelope={r.envelope}
                    durationS={r.durationS}
                    bpm={r.bpm}
                    snapToBar={snap}
                    cues={r.cues as WaveCue[]}
                    onMoveCue={(ci, ms) => updateCue(ri, ci, { positionMs: ms })}
                  />
                )}

                {r.cues.length > 0 && (
                  <div className="space-y-1">
                    {r.cues.map((c, ci) => (
                      <div key={ci} className="flex items-center gap-2">
                        <span
                          className="size-2.5 shrink-0 rounded-[2px]"
                          style={{ background: c.color ?? '#8A9099' }}
                        />
                        <Input
                          className="h-7 w-40"
                          value={c.label}
                          onChange={(e) => updateCue(ri, ci, { label: e.target.value })}
                        />
                        <span className="font-mono text-caption tabular-nums text-ink-mid">
                          {formatDuration(c.positionMs / 1000)}
                        </span>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          onClick={() => removeCue(ri, ci)}
                          aria-label={tp('removeCue')}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    ))}
                    <Button size="sm" variant="secondary" onClick={() => saveOne(ri)} disabled={r.saved}>
                      <Save /> {tp('saveOneBtn', { n: r.cues.length })}
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/* --------------------------------------------------------------------- Tag */

interface Proposal {
  trackId: number;
  artist: string;
  title: string;
  field: 'year' | 'genre';
  current: string | null;
  proposed: string;
  source: string;
}

type Provider = 'musicbrainz' | 'discogs';

function TagsTab() {
  const { locale } = useAppState();
  const tp = (k: string, p?: Record<string, string | number>) => pageText(locale, 'tagger', k, p);
  const { run } = useJobs();
  const { push } = useNotifications();
  const { refresh } = useLibrary();

  const [provider, setProvider] = useState<Provider>('musicbrainz');
  const [hasDiscogsToken, setHasDiscogsToken] = useState(false);
  const [directWrites, setDirectWrites] = useState(false);
  const [proposals, setProposals] = useState<Proposal[] | null>(null);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [summary, setSummary] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<{ text: string; target: SaveTarget } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmOriginal, setConfirmOriginal] = useState(false);

  useEffect(() => {
    window.crateforge.settings.get('directWrites').then((v) => setDirectWrites(v === '1'));
    window.crateforge.settings.get('discogsToken').then((v) => setHasDiscogsToken(!!v));
  }, []);

  const doPropose = async () => {
    setError(null);
    setOutcome(null);
    setProposals(null);
    setBusy(true);
    try {
      const r = await run(tp('proposeBtn'), () => window.crateforge.tagger.propose(50, provider));
      if (!r.ok) {
        setError(r.message);
      } else {
        setProposals(r.proposals);
        setChecked(new Set(r.proposals.map((_: Proposal, i: number) => i)));
        setSummary(
          tp('summary', {
            n: r.queried,
            prov: provider === 'discogs' ? 'Discogs' : 'MusicBrainz',
            skipped: r.skipped
          })
        );
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const chosen = () => (proposals ?? []).filter((_, i) => checked.has(i));

  const doApplyUdm = async () => {
    const r = await window.crateforge.tagger.apply(chosen(), 'udm');
    const text = tp('outUdm', { n: r.applied });
    setOutcome({ text, target: 'udm' });
    setProposals(null);
    await refresh();
    push({ kind: 'success', job: true, title: tp('title'), body: text });
  };

  const doApplyOriginal = async () => {
    setBusy(true);
    setError(null);
    try {
      /* Non annullabile: la scrittura dei tag entra nei file audio e il
         ripristino vive dentro il sidecar, in un blocco `except` che un
         processo terminato a forza non esegue mai. */
      const r = await run(
        tp('applyOriginalBtn'),
        () => window.crateforge.tagger.apply(chosen(), 'original'),
        { cancellable: false }
      );
      if (!r.ok) {
        setError(r.message ?? tp('writeFailed'));
      } else {
        const text = tp('outOrig', { n: r.written, failed: r.failed ?? 0, dir: r.backupDir });
        setOutcome({ text, target: 'original' });
        setProposals(null);
        await refresh();
        push({ kind: 'warning', job: true, title: tp('title'), body: text });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <Notice variant="warning" title={tp('warnTitle')}>
        {tp('warnBody')}
      </Notice>
      <RekordboxDiff page="tagger" />

      <Card>
        <CardHeader>
          <CardTitle className="text-body font-semibold">{tp('step1')}</CardTitle>
          <CardDescription>{tp('step1Desc')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Segmented
            value={provider}
            onChange={setProvider}
            options={[
              { value: 'musicbrainz', label: 'MusicBrainz' },
              { value: 'discogs', label: 'Discogs' }
            ]}
          />
          {provider === 'discogs' && !hasDiscogsToken && (
            <Notice variant="warning">{tp('needToken')}</Notice>
          )}
          <Button
            variant="primary"
            onClick={doPropose}
            working={busy}
            disabled={provider === 'discogs' && !hasDiscogsToken}
          >
            <Globe /> {tp('proposeBtn')}
          </Button>
          {summary && <p className="text-caption text-ink-lo">{summary}</p>}
        </CardContent>
      </Card>

      {proposals && (
        <Card>
          <CardHeader>
            <CardTitle className="text-body font-semibold">{tp('step2', { n: proposals.length })}</CardTitle>
            <CardDescription>{tp('step2Desc')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {proposals.length === 0 ? (
              <EmptyState title={tp('noneTitle')}>{tp('noneBody')}</EmptyState>
            ) : (
              <>
                <div className="max-h-96 overflow-auto rounded-card border border-line-subtle">
                  {proposals.map((p, i) => (
                    <label
                      key={`${p.trackId}-${p.field}-${i}`}
                      className="flex cursor-pointer items-center gap-2.5 border-b border-line-subtle px-3 py-1.5 transition-colors duration-press last:border-b-0 hover:bg-surface-hover"
                    >
                      <Checkbox
                        checked={checked.has(i)}
                        onCheckedChange={() =>
                          setChecked((prev) => {
                            const next = new Set(prev);
                            next.has(i) ? next.delete(i) : next.add(i);
                            return next;
                          })
                        }
                      />
                      <span className="min-w-0 flex-1 truncate text-caption text-ink-mid">
                        <span className="text-ink-hi">
                          {p.artist} — {p.title}
                        </span>
                      </span>
                      <Badge variant="neutral">{p.field}</Badge>
                      <span className="w-28 shrink-0 truncate text-right font-mono text-caption text-ink-lo">
                        {p.current ?? '—'}
                      </span>
                      <span className="text-ink-lo">→</span>
                      <span className="w-28 shrink-0 truncate font-mono text-caption text-accent">
                        {p.proposed}
                      </span>
                      <span className="w-24 shrink-0 truncate text-caption text-ink-lo">
                        {p.source}
                      </span>
                    </label>
                  ))}
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button variant="primary" onClick={doApplyUdm} disabled={checked.size === 0 || busy}>
                    <CheckCheck /> {tp('applyUdmBtn', { n: checked.size })}
                  </Button>
                  {directWrites && (
                    <Button
                      variant="destructive"
                      onClick={() => setConfirmOriginal(true)}
                      disabled={checked.size === 0 || busy}
                    >
                      {tp('applyOriginalBtn', { n: checked.size })}
                    </Button>
                  )}
                </div>
                <SaveTargetNotice target="udm" />
              </>
            )}
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
        open={confirmOriginal}
        onOpenChange={setConfirmOriginal}
        title={tp('origTitle')}
        confirmWord="SCRIVI"
        confirmLabel={tp('origLabel', { n: checked.size })}
        onConfirm={doApplyOriginal}
        facts={[
          { label: tp('factFiles'), value: checked.size.toLocaleString(locale) },
          { label: tp('factTarget'), value: tp('factTargetOriginal'), warn: true },
          { label: tp('factBackup'), value: tp('yes') }
        ]}
        description={<p>{tp('origBody')}</p>}
      />
    </div>
  );
}

/* ------------------------------------------------------------------- Stems */

function StemsTab() {
  const { locale } = useAppState();
  const tp = (k: string, p?: Record<string, string | number>) => pageText(locale, 'stems', k, p);
  const { run } = useJobs();
  const { push } = useNotifications();

  const [search, setSearch] = useState('');
  const [results, setResults] = useState<TrackRow[]>([]);
  const [track, setTrack] = useState<TrackRow | null>(null);
  const [outDir, setOutDir] = useState('');
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const doSearch = async () => {
    const r = await window.crateforge.library.page({ offset: 0, limit: 20, search });
    setResults(r.rows);
  };

  const doRun = async () => {
    if (!track || !outDir) return;
    setError(null);
    setOutcome(null);
    setBusy(true);
    try {
      const r = await run(tp('runBtn'), () => window.crateforge.stems.run(track.id, outDir), {
        cancellable: true
      });
      if (!r.ok) setError(r.message ?? tp('errDefault'));
      else {
        const text = tp('outDone', { dir: outDir });
        setOutcome(text);
        push({ kind: 'success', job: true, title: tp('title'), body: text });
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <Notice variant="warning" title={tp('warnTitle')}>
        {tp('warnBody')}
      </Notice>

      <Card>
        <CardHeader>
          <CardTitle className="text-body font-semibold">{tp('cardTitle')}</CardTitle>
          <CardDescription>{tp('cardDesc')}</CardDescription>
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
              {results.map((tr) => (
                <button
                  key={tr.id}
                  onClick={() => setTrack(tr)}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-caption transition-colors duration-press hover:bg-surface-hover ${
                    track?.id === tr.id ? 'bg-accent/10 text-ink-hi' : 'text-ink-mid'
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate">
                    {tr.artist ?? '?'} — {tr.title ?? '?'}
                  </span>
                </button>
              ))}
            </div>
          )}

          <PathField
            label={tp('fOutDir')}
            value={outDir}
            onBrowse={async () => {
              const d = await window.crateforge.dialog.openDirectory();
              if (d) setOutDir(d);
            }}
          />

          {track && (
            <StatTile label={tp('selected')} value={`${track.artist ?? '?'} — ${track.title ?? '?'}`} />
          )}

          <SaveTargetNotice target="copy" />

          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={doRun} disabled={!track || !outDir} working={busy}>
              <AudioLines /> {tp('runBtn')}
            </Button>
            {busy && (
              <Button variant="ghost" onClick={() => window.crateforge.jobs.cancel()}>
                <XCircle /> {tp('cancelBtn')}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {outcome && <Notice variant="success">{outcome}</Notice>}
      {error && <Notice variant="destructive">{error}</Notice>}
    </div>
  );
}
