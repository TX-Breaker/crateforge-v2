import { useEffect, useRef, useState } from 'react';
import { Check, Search, Sparkles, X } from 'lucide-react';
import { Sheet } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input, Notice, Select } from '@/components/ui/misc';
import { InfoTip } from '@/components/ui/page';
import { Waveform, type WaveBand } from '@/components/data/Waveform';
import { useLibrary } from '@/lib/library';
import { useNotifications } from '@/lib/notifications';
import { useT } from '@/lib/strings';
import { CheckRow, RowList, SelectBar, toggleIn, trackName } from './parts';

/**
 * Auto-Cue: scegli i brani (cercandoli o da una playlist), CrateForge propone
 * gli hot cue, tu li guardi sull'onda e salvi. Le proposte si possono
 * spostare trascinandole o togliere.
 */

interface TrackRow {
  id: number;
  title: string | null;
  artist: string | null;
  path: string | null;
}

interface Cue {
  label: string;
  positionMs: number;
  color: string | null;
}

interface Result {
  track: TrackRow;
  cues: Cue[];
  error: string | null;
  saved: boolean;
  envelope: number[];
  bands: WaveBand[];
  durationS: number | null;
  bpm: number | null;
}

const LIMIT = 100;

export function AutoCueSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useT();
  const { push } = useNotifications();
  const { sidecar } = useLibrary();
  const [search, setSearch] = useState('');
  const [playlists, setPlaylists] = useState<{ id: number; name: string; trackCount: number }[]>([]);
  const [playlistId, setPlaylistId] = useState('');
  const [tracks, setTracks] = useState<TrackRow[] | null>(null);
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  const [results, setResults] = useState<Result[]>([]);
  const [progress, setProgress] = useState<{ i: number; tot: number } | null>(null);
  const stop = useRef(false);

  useEffect(() => {
    if (open) void window.crateforge.planner.playlists().then(setPlaylists);
  }, [open]);

  const take = (rows: TrackRow[]) => {
    setTracks(rows);
    setChosen(new Set(rows.filter((r) => r.path).map((r) => r.id)));
    setResults([]);
  };

  const doSearch = async () => {
    setPlaylistId('');
    const r = (await window.crateforge.library.page({ offset: 0, limit: LIMIT, search })) as { rows: TrackRow[] };
    take(r.rows);
  };

  const fromPlaylist = async (id: string) => {
    setPlaylistId(id);
    const r = (await window.crateforge.library.pageByPlaylist(Number(id), 0, LIMIT)) as { rows: TrackRow[] };
    take(r.rows);
  };

  const analyze = async () => {
    const list = (tracks ?? []).filter((tr) => chosen.has(tr.id) && tr.path);
    stop.current = false;
    const out: Result[] = [];
    setResults([]);
    for (let i = 0; i < list.length && !stop.current; i++) {
      setProgress({ i: i + 1, tot: list.length });
      const tr = list[i];
      try {
        const r = (await window.crateforge.cues.analyze(tr.id)) as {
          ok: boolean;
          message?: string;
          cues?: Cue[];
          envelope?: number[];
          bands?: WaveBand[];
          durationS?: number;
          bpm?: number;
        };
        out.push({
          track: tr,
          cues: r.ok ? (r.cues ?? []) : [],
          error: r.ok ? null : (r.message ?? t('cue.failed')),
          saved: false,
          envelope: r.envelope ?? [],
          bands: r.bands ?? [],
          durationS: r.durationS ?? null,
          bpm: r.bpm ?? null
        });
      } catch (e) {
        out.push({ track: tr, cues: [], error: String(e), saved: false, envelope: [], bands: [], durationS: null, bpm: null });
      }
      setResults([...out]);
    }
    setProgress(null);
  };

  const patch = (ri: number, fn: (r: Result) => Result) => setResults((prev) => prev.map((r, i) => (i === ri ? fn(r) : r)));

  const saveOne = async (ri: number) => {
    const r = results[ri];
    await window.crateforge.cues.save(r.track.id, r.cues);
    patch(ri, (x) => ({ ...x, saved: true }));
  };

  const pending = results.filter((r) => !r.saved && !r.error && r.cues.length > 0);

  const saveAll = async () => {
    let n = 0;
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.saved || r.error || r.cues.length === 0) continue;
      await window.crateforge.cues.save(r.track.id, r.cues);
      n++;
    }
    setResults((prev) => prev.map((r) => (r.error || r.cues.length === 0 ? r : { ...r, saved: true })));
    push({ kind: 'success', title: t('cue.savedAll', { n }), body: t('tag.where') });
  };

  const engineDown = sidecar !== null && !sidecar.available;

  return (
    <Sheet
      wide
      open={open}
      onOpenChange={onOpenChange}
      title={t('fix.i.noCues')}
      icon={<Sparkles />}
      footer={
        progress ? (
          <>
            <span className="mr-auto text-caption text-ink-mid">{t('cue.analyzing', progress)}</span>
            <Button variant="secondary" onClick={() => (stop.current = true)}>
              {t('c.stop')}
            </Button>
          </>
        ) : pending.length > 0 ? (
          <Button variant="primary" onClick={saveAll}>
            <Check /> {t('cue.saveAll', { n: pending.length })}
          </Button>
        ) : tracks && tracks.length > 0 ? (
          <Button variant="primary" disabled={chosen.size === 0 || engineDown} onClick={analyze}>
            <Sparkles /> {t('cue.analyze', { n: chosen.size })}
          </Button>
        ) : undefined
      }
    >
      <div className="space-y-4">
        {engineDown && <Notice variant="warning">{t('cue.engine')}</Notice>}

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex min-w-[260px] flex-1 gap-2">
            <Input
              value={search}
              placeholder={t('cue.searchPh')}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void doSearch()}
            />
            <Button variant="secondary" onClick={doSearch} aria-label={t('c.search')}>
              <Search />
            </Button>
          </div>
          <Select
            className="min-w-[200px]"
            value={playlistId}
            placeholder={t('cue.pickPlaylist')}
            label={t('cue.playlist')}
            onValueChange={fromPlaylist}
            options={playlists.map((p) => ({ value: String(p.id), label: p.name, hint: String(p.trackCount) }))}
          />
          <InfoTip text={t('fix.tip.noCues')} />
        </div>

        {tracks && results.length === 0 && !progress && (
          <div className="space-y-2">
            <SelectBar
              count={chosen.size}
              onAll={() => setChosen(new Set(tracks.filter((r) => r.path).map((r) => r.id)))}
              onNone={() => setChosen(new Set())}
            />
            <RowList>
              {tracks.map((tr) => (
                <CheckRow
                  key={tr.id}
                  checked={chosen.has(tr.id)}
                  disabled={!tr.path}
                  onToggle={() => setChosen((s) => toggleIn(s, tr.id))}
                  aside={!tr.path ? <span className="text-caption text-warning">{t('cue.noPath')}</span> : undefined}
                >
                  {trackName(tr)}
                </CheckRow>
              ))}
            </RowList>
          </div>
        )}

        {results.map((r, ri) => (
          <div key={r.track.id} className="space-y-2 rounded-card border border-line-subtle p-3">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-body text-ink-hi">{trackName(r.track)}</span>
              {r.bpm && <span className="font-mono text-caption text-ink-lo">{r.bpm.toFixed(1)} BPM</span>}
              {r.saved ? (
                <span className="flex items-center gap-1 text-caption text-success">
                  <Check className="size-3.5" /> {t('cue.saved')}
                </span>
              ) : (
                !r.error &&
                r.cues.length > 0 && (
                  <Button size="sm" variant="secondary" onClick={() => saveOne(ri)}>
                    {t('c.save')}
                  </Button>
                )
              )}
            </div>
            {r.error ? (
              <p className="text-caption text-warning">{r.error}</p>
            ) : (
              <>
                {r.durationS && r.envelope.length > 0 && (
                  <Waveform
                    envelope={r.envelope}
                    bands={r.bands}
                    durationS={r.durationS}
                    bpm={r.bpm}
                    snapToBar
                    cues={r.cues}
                    onMoveCue={(ci, ms) =>
                      patch(ri, (x) => ({
                        ...x,
                        saved: false,
                        cues: x.cues.map((c, j) => (j === ci ? { ...c, positionMs: ms } : c))
                      }))
                    }
                  />
                )}
                <div className="flex flex-wrap gap-1.5">
                  {r.cues.map((c, ci) => (
                    <span
                      key={ci}
                      className="inline-flex items-center gap-1 rounded-chip border border-line-subtle bg-surface-3 py-0.5 pl-2 pr-1 font-mono text-caption text-ink-mid"
                    >
                      <span className="size-2 rounded-full" style={{ background: c.color ?? 'var(--accent)' }} />
                      {c.label} · {(c.positionMs / 1000).toFixed(1)}s
                      <button
                        aria-label={t('c.close')}
                        className="grid size-4 place-items-center rounded-full text-ink-lo hover:text-ink-hi"
                        onClick={() =>
                          patch(ri, (x) => ({ ...x, saved: false, cues: x.cues.filter((_, j) => j !== ci) }))
                        }
                      >
                        <X className="size-3" />
                      </button>
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </Sheet>
  );
}
