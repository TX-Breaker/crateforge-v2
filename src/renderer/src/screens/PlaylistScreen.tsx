import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowRightLeft,
  FileSpreadsheet,
  FileText,
  ListOrdered,
  ListPlus,
  Send,
  Sparkles
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/misc';
import { Figure, PageHeader, Section } from '@/components/ui/page';
import { Sheet } from '@/components/ui/sheet';
import { DangerConfirmDialog } from '@/components/DangerConfirmDialog';
import { useAppState } from '@/lib/appState';
import { useJobs } from '@/lib/jobs';
import { useLibrary } from '@/lib/library';
import { useNotifications } from '@/lib/notifications';
import { useT } from '@/lib/strings';
import { cn, formatDuration } from '@/lib/utils';

/**
 * Playlist: le liste dei programmi, portate nell'archivio dagli import.
 *
 * La schermata non crea liste sue: mostra quelle che esistono davvero in
 * Rekordbox, Serato e Engine, e offre tre cose su ciascuna: guardarle (brani,
 * durata, tasti), sistemarle (doppioni di fila, file mancanti) e portarle
 * verso un altro programma — con gli stessi export già provati di Sincronizza.
 * Il dettaglio di cosa sia sicuro inviare dove resta in quel registro, non qui.
 */

interface PlaylistRow {
  id: number;
  name: string;
  isFolder: boolean;
  parentName: string | null;
  trackCount: number;
  source: string;
}

interface DetailTrack {
  id: number;
  position: number;
  title: string | null;
  artist: string | null;
  bpm: number | null;
  camelot: string | null;
  durationS: number | null;
  path: string | null;
  missing: boolean;
}

interface Detail {
  name: string;
  tracks: DetailTrack[];
  stats: {
    durationS: number;
    bpmMin: number | null;
    bpmMax: number | null;
    keys: { key: string; n: number }[];
  };
}

interface Analysis {
  tracks: number;
  problems: number;
  transitions: { from: { title: string | null }; to: { title: string | null }; flags: string[] }[];
}

export function PlaylistScreen() {
  const t = useT();
  const { locale } = useAppState();
  const { run } = useJobs();
  const { push } = useNotifications();
  const { rbPaths } = useLibrary();
  const [rows, setRows] = useState<PlaylistRow[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [sendOpen, setSendOpen] = useState(false);
  /* Scritture DENTRO i database dei programmi: la parola chiave, come ovunque
     nell'applicazione. Un clic solo non basta per toccare il master.db. */
  const [confirmSend, setConfirmSend] = useState<'rb' | 's4' | null>(null);
  const [masterDbWrites, setMasterDbWrites] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const list = (await window.crateforge.playlists.list()) as PlaylistRow[];
    setRows(list);
    if (list.length > 0 && !list.some((r) => r.id === selected && !r.isFolder)) {
      const first = list.find((r) => !r.isFolder && r.trackCount > 0);
      setSelected(first ? first.id : null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void reload();
    void window.crateforge.settings.get('masterDbWrites').then((v) => setMasterDbWrites(v === '1'));
  }, [reload]);

  useEffect(() => {
    setAnalysis(null);
    if (selected === null) {
      setDetail(null);
      return;
    }
    void (window.crateforge.playlists.detail(selected) as Promise<Detail>).then(setDetail).catch((e) => setError(String(e)));
  }, [selected]);

  const n = (v: number) => v.toLocaleString(locale);

  const refreshDetail = async () => {
    if (selected === null) return;
    setDetail((await window.crateforge.playlists.detail(selected)) as Detail);
  };

  const analyze = async () => {
    if (selected === null) return;
    setError(null);
    try {
      setAnalysis((await run(t('pl.analyze'), () => window.crateforge.planner.analyze(selected))) as Analysis);
    } catch (e) {
      setError(String(e));
    }
  };

  const dedupe = async () => {
    if (selected === null) return;
    setError(null);
    try {
      const r = (await run(t('pl.dedupe'), () => window.crateforge.playlists.dedupe(selected))) as {
        removed: number;
      };
      push({
        kind: r.removed ? 'success' : 'info',
        job: true,
        title: t('pl.dedupeDone', { n: r.removed.toLocaleString(locale) })
      });
      if (r.removed) await refreshDetail();
    } catch (e) {
      setError(String(e));
    }
  };

  const saveExport = async (kind: 'm3u' | 'csv') => {
    if (selected === null || !detail) return;
    const out = (await window.crateforge.dialog.saveFile(`playlist.${kind}`, [
      kind === 'm3u'
        ? { name: 'Playlist M3U8', extensions: ['m3u8'] }
        : { name: 'CSV', extensions: ['csv'] }
    ])) as string | null;
    if (!out) return;
    const r =
      kind === 'm3u'
        ? ((await window.crateforge.playlists.exportM3u(selected, out)) as { ok: boolean; written?: number; message?: string })
        : ((await window.crateforge.playlists.exportCsv(selected, out)) as { ok: boolean; written?: number; message?: string });
    if (!r.ok) setError(r.message ?? t('c.error'));
    else push({ kind: 'success', job: true, title: t('pl.exportDone', { n: (r.written ?? 0).toLocaleString(locale) }), body: out });
  };

  /* ---- Invio verso i programmi: gli stessi export già provati di Sincronizza ---- */

  const toRekordbox = async () => {
    if (selected === null || !detail) return;
    const rb = await window.crateforge.rekordbox.defaultPaths();
    const dbPath = rb.masterDbExists
      ? rb.masterDb
      : ((await window.crateforge.dialog.openFile([{ name: 'Rekordbox master.db', extensions: ['db'] }], rb.dir)) as string | null);
    if (!dbPath) return;
    const options = rb.optionsJsonExists
      ? rb.optionsJson
      : ((await window.crateforge.dialog.openFile([{ name: 'options.json', extensions: ['json'] }], rb.dir)) as string | null);
    try {
      const r = (await run(
        t('pl.toRb'),
        () =>
          window.crateforge.masterdb.createPlaylist(
            detail.tracks.map((x) => x.id),
            detail.name,
            dbPath,
            options
          ),
        { cancellable: false }
      )) as { ok: boolean; message?: string; added?: number; missing?: number; backupDir?: string };
      if (!r.ok) setError(r.message ?? t('c.error'));
      else
        push({
          kind: 'success',
          job: true,
          title: t('pl.toRbDone', { n: (r.added ?? 0).toLocaleString(locale) }),
          body: r.backupDir
        });
    } finally {
      setSendOpen(false);
    }
  };

  const toSerato = async () => {
    if (selected === null) return;
    const dir = (await window.crateforge.dialog.openDirectory()) as string | null;
    if (!dir) return;
    try {
      const r = (await run(t('pl.toSerato'), () =>
        window.crateforge.exporter.seratoCrates(dir, { playlistIds: [selected] })
      )) as { ok: boolean; written?: number; skipped?: string[]; message?: string };
      if (!r.ok) setError(r.message ?? t('c.error'));
      else push({ kind: 'success', job: true, title: t('pl.toSeratoDone', { n: (r.written ?? 0).toLocaleString(locale) }) });
    } finally {
      setSendOpen(false);
    }
  };

  const toSerato4 = async () => {
    if (selected === null) return;
    try {
      const r = (await run(t('pl.toSerato4'), () =>
        window.crateforge.exporter.serato4Crates(undefined, { playlistIds: [selected] })
      )) as { ok: boolean; created?: number; linked?: number; notInLibrary?: string[]; message?: string };
      if (!r.ok) setError(r.message ?? t('c.error'));
      else
        push({
          kind: 'success',
          job: true,
          title: t('pl.toSerato4Done', { n: (r.created ?? 0).toLocaleString(locale) }),
          body: r.notInLibrary?.length ? t('pl.notInLib', { n: r.notInLibrary.length.toLocaleString(locale) }) : undefined
        });
    } finally {
      setSendOpen(false);
    }
  };

  const playlists = rows.filter((r) => !r.isFolder);
  const missingCount = detail?.tracks.filter((x) => x.missing).length ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader title={t('nav.playlists')} />

      <div className="grid gap-6 lg:grid-cols-[minmax(260px,340px)_minmax(0,1fr)]">
        <Section title={t('pl.lists')} tip={t('pl.listsTip')}>
          {playlists.length === 0 ? (
            <p className="text-body text-ink-lo">{t('pl.empty')}</p>
          ) : (
            <ul className="max-h-[560px] space-y-0.5 overflow-auto">
              {playlists.map((p) => (
                <li key={p.id}>
                  {p.parentName && (
                    <div className="px-2 pt-2 text-caption text-ink-lo">{p.parentName}</div>
                  )}
                  <button
                    onClick={() => setSelected(p.id)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-control px-2 py-1.5 text-left transition-colors duration-press',
                      'hover:bg-surface-hover',
                      selected === p.id && 'bg-surface-active text-ink-hi'
                    )}
                  >
                    <ListOrdered className="size-4 shrink-0 text-ink-lo" />
                    <span className="min-w-0 flex-1 truncate text-body text-ink-hi">{p.name}</span>
                    <span className="font-mono text-caption tabular-nums text-ink-mid">
                      {n(p.trackCount)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {detail ? (
          <div className="space-y-6">
            <Section
              title={detail.name}
              actions={
                <>
                  <Button size="sm" variant="ghost" onClick={analyze}>
                    <Sparkles /> {t('pl.analyze')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={dedupe}>
                    <ListPlus /> {t('pl.dedupe')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void saveExport('m3u')}>
                    <FileText /> M3U8
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void saveExport('csv')}>
                    <FileSpreadsheet /> CSV
                  </Button>
                  <Button size="sm" variant="primary" onClick={() => setSendOpen(true)}>
                    <Send /> {t('pl.send')}
                  </Button>
                </>
              }
            >
              <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Figure value={n(detail.tracks.length)} label={t('c.tracks')} />
                <Figure value={formatDuration(detail.stats.durationS)} label={t('pl.duration')} />
                <Figure
                  value={
                    detail.stats.bpmMin != null
                      ? `${Math.round(detail.stats.bpmMin)}–${Math.round(detail.stats.bpmMax ?? 0)}`
                      : '—'
                  }
                  label="BPM"
                />
                <Figure
                  value={missingCount ? n(missingCount) : t('c.no')}
                  label={t('pl.missing')}
                  tone={missingCount ? 'warning' : 'good'}
                />
              </div>
              {detail.stats.keys.length > 0 && (
                <p className="mb-2 text-caption text-ink-mid">
                  {t('pl.keysTop')}{' '}
                  {detail.stats.keys.map((k) => `${k.key} (${n(k.n)})`).join(' · ')}
                </p>
              )}
              {error && (
                <Notice variant="destructive" className="mb-2">
                  {error}
                </Notice>
              )}
              <ol className="divide-y divide-line-subtle">
                {detail.tracks.map((x) => (
                  <li key={`${x.id}-${x.position}`} className="flex items-center gap-3 py-1.5">
                    <span className="w-6 font-mono text-caption tabular-nums text-ink-lo">
                      {x.position + 1}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-body text-ink-hi">
                      {x.title ?? '—'}
                      {x.artist ? <span className="text-ink-mid"> — {x.artist}</span> : null}
                    </span>
                    {x.missing && (
                      <span title={x.path ?? undefined}>
                        <AlertTriangle className="size-3.5 text-warning" />
                      </span>
                    )}
                    <span className="w-12 text-right font-mono text-caption tabular-nums text-ink-mid">
                      {x.bpm ? x.bpm.toFixed(0) : '—'}
                    </span>
                    <span className="w-8 text-right font-mono text-caption text-accent">
                      {x.camelot ?? '—'}
                    </span>
                    <span className="w-12 text-right font-mono text-caption tabular-nums text-ink-lo">
                      {formatDuration(x.durationS)}
                    </span>
                  </li>
                ))}
              </ol>
            </Section>

            {analysis && (
              <Section
                title={
                  analysis.problems
                    ? t('pl.problems', { n: analysis.problems.toLocaleString(locale) })
                    : t('pl.noProblems')
                }
              >
                {analysis.problems === 0 ? (
                  <p className="text-body text-ink-mid">{t('pl.noProblemsBody')}</p>
                ) : (
                  <ul className="divide-y divide-line-subtle">
                    {analysis.transitions
                      .filter((tr) => tr.flags.includes('key-clash') || tr.flags.includes('bpm-jump'))
                      .slice(0, 12)
                      .map((tr, i) => (
                        <li key={i} className="flex items-center gap-2 py-1.5 text-caption">
                          <ArrowRightLeft className="size-3.5 shrink-0 text-warning" />
                          <span className="min-w-0 flex-1 truncate text-ink-hi">
                            {tr.from.title ?? '—'} → {tr.to.title ?? '—'}
                          </span>
                          <span className="shrink-0 font-mono text-ink-mid">{tr.flags.join(', ')}</span>
                        </li>
                      ))}
                  </ul>
                )}
              </Section>
            )}
          </div>
        ) : (
          <Section>
            <p className="text-body text-ink-lo">{t('pl.pick')}</p>
          </Section>
        )}
      </div>

      <Sheet
        open={sendOpen}
        onOpenChange={setSendOpen}
        title={t('pl.send')}
        icon={<Send />}
        footer={
          <Button variant="secondary" onClick={() => setSendOpen(false)}>
            {t('c.close')}
          </Button>
        }
      >
        <div className="space-y-3">
          <p className="text-caption text-ink-mid">{t('pl.sendTip')}</p>
          {masterDbWrites && (
            <Button variant="secondary" className="w-full justify-start" onClick={() => setConfirmSend('rb')}>
              <ListOrdered /> {t('pl.toRb')}
            </Button>
          )}
          <Button variant="secondary" className="w-full justify-start" onClick={toSerato}>
            <ListOrdered /> {t('pl.toSerato')}
          </Button>
          <Button variant="secondary" className="w-full justify-start" onClick={() => setConfirmSend('s4')}>
            <ListOrdered /> {t('pl.toSerato4')}
          </Button>
          <p className="text-caption text-ink-lo">{t('pl.sendWhere')}</p>
        </div>
      </Sheet>

      <DangerConfirmDialog
        open={confirmSend !== null}
        onOpenChange={(o) => !o && setConfirmSend(null)}
        title={confirmSend === 'rb' ? t('set.mdbTitle') : t('pl.s4Title')}
        description={confirmSend === 'rb' ? t('set.mdbBody') : t('pl.s4Body')}
        facts={detail ? [{ label: detail.name, value: (detail.tracks.length ?? 0).toLocaleString(locale) }] : []}
        confirmWord={confirmSend === 'rb' ? 'MASTERDB' : 'SCRIVI'}
        confirmLabel={t('set.mdbBtn')}
        onConfirm={() => {
          const which = confirmSend;
          setConfirmSend(null);
          void (which === 'rb' ? toRekordbox() : toSerato4());
        }}
      />
    </div>
  );
}
