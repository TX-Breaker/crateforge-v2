import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CopyX,
  FileWarning,
  Fingerprint,
  FolderOpen,
  FolderSearch,
  RotateCcw,
  ShieldCheck,
  Trash2
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Eyebrow, StatTile } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox, EmptyState, Notice, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/misc';
import { PathField } from '@/components/ui/fields';
import { DangerConfirmDialog } from '@/components/DangerConfirmDialog';
import { SaveTargetNotice } from '@/components/SaveTargetNotice';
import { RekordboxDiff } from '@/components/RekordboxDiff';
import { useAppState } from '@/lib/appState';
import { useJobs } from '@/lib/jobs';
import { useLibrary } from '@/lib/library';
import { useNotifications } from '@/lib/notifications';
import { useRouter } from '@/lib/router';
import { pageText } from '@/lib/i18nPages';
import { formatBytes, shortenPath } from '@/lib/utils';

/**
 * Pulizia — tre pagine della V1 fuse in una destinazione con tab, perché
 * rispondono alla stessa domanda: cosa in questa libreria non dovrebbe esserci.
 *
 *   Orfani     ← "File orfani"
 *   Duplicati  ← "Duplicati (impronta)"   [Esperto]
 *   Quarantena ← l'annulla delle prime due
 *
 * La quarantena è una cartella, non un'eliminazione: niente esce mai dal disco.
 */
export function CleanupPage() {
  const { locale, mode } = useAppState();
  const { tab, setTab } = useRouter();
  const expert = mode === 'expert';

  return (
    <div className="space-y-4">
      <RekordboxDiff page="orphans" />
      <Tabs value={tab ?? 'orphans'} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="orphans">
            <FileWarning /> {pageText(locale, 'tabs', 'orphans')}
          </TabsTrigger>
          {expert && (
            <TabsTrigger value="duplicates">
              <Fingerprint /> {pageText(locale, 'tabs', 'duplicates')}
            </TabsTrigger>
          )}
          <TabsTrigger value="quarantine">
            <ShieldCheck /> {pageText(locale, 'tabs', 'quarantine')}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="orphans">
          <OrphansTab />
        </TabsContent>
        {expert && (
          <TabsContent value="duplicates">
            <DuplicatesTab />
          </TabsContent>
        )}
        <TabsContent value="quarantine">
          <QuarantineTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ------------------------------------------------------------------ Orfani */

interface Orphan {
  path: string;
  size: number;
  mtimeMs: number;
}

interface ScanResult {
  orphans: Orphan[];
  scannedFiles: number;
  knownTracks: number;
  reclaimableBytes: number;
  scanId: string;
}

const PAGE_SIZE = 100;

function OrphansTab() {
  const { locale } = useAppState();
  const tp = (k: string, p?: Record<string, string | number>) => pageText(locale, 'orphans', k, p);
  const tc = (k: string, p?: Record<string, string | number>) => pageText(locale, 'common', k, p);
  const { run } = useJobs();
  const { push } = useNotifications();

  const [musicDir, setMusicDir] = useState('');
  const [quarantineDir, setQuarantineDir] = useState('');
  const [result, setResult] = useState<ScanResult | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [confirmMove, setConfirmMove] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [directWrites, setDirectWrites] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.crateforge.settings.get('directWrites').then((v) => setDirectWrites(v === '1'));
  }, []);

  const pageItems = useMemo(
    () => (result ? result.orphans.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE) : []),
    [result, page]
  );

  const selectedBytes = useMemo(() => {
    if (!result) return 0;
    let sum = 0;
    for (const o of result.orphans) if (selected.has(o.path)) sum += o.size;
    return sum;
  }, [result, selected]);

  const pickDir = async (setter: (v: string) => void) => {
    const d = await window.crateforge.dialog.openDirectory();
    if (d) setter(d);
  };

  const doScan = async () => {
    setError(null);
    setOutcome(null);
    setResult(null);
    setSelected(new Set());
    setPage(0);
    setBusy(true);
    try {
      setResult((await run(tp('scan'), () => window.crateforge.orphans.scan(musicDir))) as ScanResult);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const removeFromList = (files: string[], failed: { path: string }[]) => {
    const failedSet = new Set(failed.map((f) => f.path));
    const moved = new Set(files.filter((f) => !failedSet.has(f)));
    setResult((prev) =>
      prev ? { ...prev, orphans: prev.orphans.filter((o) => !moved.has(o.path)) } : prev
    );
    setSelected(new Set());
  };

  const doQuarantine = async () => {
    setBusy(true);
    setError(null);
    try {
      const files = [...selected];
      const r = await run(tp('moveJob'), () =>
        window.crateforge.orphans.quarantine(files, quarantineDir, false)
      );
      const text =
        tp('outMoved', { moved: r.moved, tot: files.length, dir: r.quarantineDir }) +
        (r.failed.length ? tp('outMovedFail', { n: r.failed.length }) : '') +
        tp('outMovedTail');
      setOutcome(text);
      push({ kind: 'success', job: true, title: tp('title'), body: text });
      removeFromList(files, r.failed);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const doDelete = async () => {
    if (!result) return;
    setBusy(true);
    setError(null);
    try {
      const files = [...selected];
      const r = await run(tp('delJob'), () =>
        window.crateforge.orphans.remove(result.scanId, files, false)
      );
      const text =
        tp('outDeleted', { n: r.deleted, size: formatBytes(r.freedBytes) }) +
        (r.failed.length ? tp('outDelFail', { n: r.failed.length }) : '');
      setOutcome(text);
      push({ kind: 'warning', job: true, title: tp('title'), body: text });
      removeFromList(files, r.failed);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <Notice variant="info" title={tp('howTitle')}>
        {tp('howBody')}
      </Notice>

      <Card>
        <CardHeader>
          <CardTitle className="text-body font-semibold">{tp('step1')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <PathField label={tp('fMusic')} value={musicDir} onBrowse={() => pickDir(setMusicDir)} />
          <Button variant="primary" onClick={doScan} disabled={!musicDir} working={busy}>
            <FolderSearch /> {tp('scan')}
          </Button>
        </CardContent>
      </Card>

      {result && (
        <Card>
          <CardHeader>
            <CardTitle className="text-body font-semibold">{tp('step2')}</CardTitle>
            <CardDescription>
              {tp('resLine', {
                scanned: result.scannedFiles.toLocaleString(locale),
                known: result.knownTracks.toLocaleString(locale),
                orphans: result.orphans.length.toLocaleString(locale),
                space: formatBytes(result.reclaimableBytes)
              })}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {result.orphans.length === 0 ? (
              /* Risultato, non stato vuoto (§8.3): icona verde, e l'azione
                 propone di ALLARGARE la ricerca, non di iniziarla. */
              <EmptyState
                tone="success"
                icon={<ShieldCheck />}
                title={tp('noneTitle')}
                action={
                  <Button variant="secondary" onClick={() => pickDir(setMusicDir)}>
                    <FolderSearch /> {tp('noneAction')}
                  </Button>
                }
              >
                {tp('noneBody', {
                  files: result.scannedFiles.toLocaleString(locale)
                })}
              </EmptyState>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setSelected(new Set(result.orphans.map((o) => o.path)))}
                  >
                    {tc('selectAll')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                    {tc('deselectAll')}
                  </Button>
                  <span className="font-mono text-caption tabular-nums text-ink-mid">
                    {tp('selCount', {
                      n: selected.size.toLocaleString(locale),
                      size: formatBytes(selectedBytes)
                    })}
                  </span>
                </div>

                <div className="max-h-80 overflow-auto rounded-card border border-line-subtle">
                  {pageItems.map((o) => (
                    <label
                      key={o.path}
                      /* Altezza e corpo dalle variabili di densita': l'impostazione
                         comfortable/compatta deve valere in tutte le liste, non
                         solo in Tracce. */
                      style={{ height: 'var(--row-h)', fontSize: 'var(--row-font)' }}
                      className="flex cursor-pointer items-center gap-2.5 border-b border-line-subtle px-3 transition-colors duration-press last:border-b-0 hover:bg-surface-hover"
                    >
                      <Checkbox
                        checked={selected.has(o.path)}
                        onCheckedChange={() =>
                          setSelected((prev) => {
                            const next = new Set(prev);
                            next.has(o.path) ? next.delete(o.path) : next.add(o.path);
                            return next;
                          })
                        }
                      />
                      <span className="min-w-0 flex-1 truncate text-caption text-ink-mid" title={o.path}>
                        {o.path}
                      </span>
                      <span className="shrink-0 font-mono text-caption tabular-nums text-ink-lo">
                        {formatBytes(o.size)}
                      </span>
                    </label>
                  ))}
                </div>

                {result.orphans.length > PAGE_SIZE && (
                  <div className="flex items-center gap-2 text-caption text-ink-lo">
                    <Button size="sm" variant="ghost" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                      {tc('prev')}
                    </Button>
                    {tc('pageOf', {
                      p: page + 1,
                      tot: Math.ceil(result.orphans.length / PAGE_SIZE)
                    })}
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={(page + 1) * PAGE_SIZE >= result.orphans.length}
                      onClick={() => setPage((p) => p + 1)}
                    >
                      {tc('next')}
                    </Button>
                  </div>
                )}

                <div className="space-y-3 border-t border-line-subtle pt-3">
                  <PathField
                    label={tp('fQuarantine')}
                    value={quarantineDir}
                    onBrowse={() => pickDir(setQuarantineDir)}
                  />
                  <SaveTargetNotice target="copy" />
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="destructive"
                      size="lg"
                      disabled={selected.size === 0 || !quarantineDir || busy}
                      onClick={() => setConfirmMove(true)}
                    >
                      <FileWarning /> {tp('moveBtn', { n: selected.size })}
                    </Button>
                    {directWrites && (
                      <Button
                        variant="destructive"
                        size="lg"
                        disabled={selected.size === 0 || busy}
                        onClick={() => setConfirmDelete(true)}
                      >
                        <Trash2 /> {tp('delBtn', { n: selected.size })}
                      </Button>
                    )}
                  </div>
                  {directWrites && <p className="text-caption text-ink-lo">{tp('directNote')}</p>}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {outcome && <Notice variant="success">{outcome}</Notice>}
      {error && <Notice variant="destructive">{error}</Notice>}

      <DangerConfirmDialog
        open={confirmMove}
        onOpenChange={setConfirmMove}
        title={tp('qTitle')}
        confirmWord="SPOSTA"
        confirmLabel={tp('qLabel', { n: selected.size })}
        onConfirm={doQuarantine}
        facts={[
          { label: tp('factFiles'), value: selected.size.toLocaleString(locale) },
          { label: tp('factSize'), value: formatBytes(selectedBytes) },
          { label: tp('factDest'), value: shortenPath(quarantineDir, 34) },
          { label: tp('factReversible'), value: tp('yes') }
        ]}
        description={<p>{tp('qBody2')}</p>}
      />

      <DangerConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={tp('delTitle')}
        confirmWord="ELIMINA"
        confirmLabel={tp('delLabel', { n: selected.size })}
        onConfirm={doDelete}
        facts={[
          { label: tp('factFiles'), value: selected.size.toLocaleString(locale) },
          { label: tp('factSize'), value: formatBytes(selectedBytes) },
          { label: tp('factReversible'), value: tp('no'), warn: true }
        ]}
        description={<p>{tp('delBody2')}</p>}
      />
    </div>
  );
}

/* --------------------------------------------------------------- Duplicati */

interface DupTrack {
  id: number;
  title: string | null;
  artist: string | null;
  path: string | null;
  filesize: number | null;
  duration_s: number | null;
}

interface DupGroup {
  acousticId: string;
  tracks: DupTrack[];
}

function DuplicatesTab() {
  const { locale } = useAppState();
  const tp = (k: string, p?: Record<string, string | number>) => pageText(locale, 'dedup', k, p);
  const { run } = useJobs();
  const { push } = useNotifications();
  const { refresh } = useLibrary();

  const [groups, setGroups] = useState<DupGroup[] | null>(null);
  const [stats, setStats] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [quarantineDir, setQuarantineDir] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedBytes = useMemo(() => {
    let sum = 0;
    for (const g of groups ?? [])
      for (const t of g.tracks) if (t.path && selected.has(t.path)) sum += t.filesize ?? 0;
    return sum;
  }, [groups, selected]);

  const doRun = async () => {
    setError(null);
    setOutcome(null);
    setGroups(null);
    setSelected(new Set());
    setBusy(true);
    try {
      const r = await run(tp('runBtn'), () => window.crateforge.dedup.run());
      if (!r.ok) {
        setError(r.message);
      } else {
        setGroups(r.groups);
        const s = r.stats as { fingerprinted?: number; failed?: number; skippedMissing?: number };
        setStats(
          tp('stats', {
            done: s.fingerprinted ?? 0,
            failed: s.failed ?? 0,
            missing: s.skippedMissing ?? 0
          })
        );
        await refresh();
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const doQuarantine = async () => {
    setBusy(true);
    setError(null);
    try {
      const files = [...selected];
      const r = await run(tp('moveJob'), () =>
        window.crateforge.orphans.quarantine(files, quarantineDir, false)
      );
      const text = tp('outMoved', { n: r.moved, dir: r.quarantineDir });
      setOutcome(text);
      push({ kind: 'success', job: true, title: tp('title'), body: text });
      setSelected(new Set());
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
      <RekordboxDiff page="dedup" />

      <Card>
        <CardHeader>
          <CardTitle className="text-body font-semibold">{tp('step1')}</CardTitle>
          <CardDescription>{tp('step1Desc')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button variant="primary" onClick={doRun} working={busy}>
            <Fingerprint /> {tp('runBtn')}
          </Button>
          {stats && <p className="font-mono text-caption tabular-nums text-ink-lo">{stats}</p>}
        </CardContent>
      </Card>

      {groups && (
        <Card>
          <CardHeader>
            <CardTitle className="text-body font-semibold">{tp('step2', { n: groups.length })}</CardTitle>
            <CardDescription>{tp('step2Desc')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {groups.length === 0 ? (
              <EmptyState
                tone="success"
                icon={<ShieldCheck />}
                title={tp('noneTitle')}
                action={
                  <Button variant="secondary" onClick={doRun} working={busy}>
                    <Fingerprint /> {tp('noneAction')}
                  </Button>
                }
              >
                {tp('noneBody')}
              </EmptyState>
            ) : (
              <>
                <div className="max-h-96 space-y-2 overflow-auto">
                  {groups.map((g) => (
                    <div key={g.acousticId} className="rounded-card border border-line-subtle p-2">
                      <Eyebrow className="px-1">{g.acousticId}</Eyebrow>
                      <div className="mt-1">
                        {g.tracks.map((tr) => (
                          <label
                            key={tr.id}
                            className="flex cursor-pointer items-center gap-2.5 rounded-chip px-1 py-1 transition-colors duration-press hover:bg-surface-hover"
                          >
                            <Checkbox
                              checked={tr.path !== null && selected.has(tr.path)}
                              disabled={tr.path === null}
                              onCheckedChange={() =>
                                tr.path &&
                                setSelected((prev) => {
                                  const next = new Set(prev);
                                  next.has(tr.path!) ? next.delete(tr.path!) : next.add(tr.path!);
                                  return next;
                                })
                              }
                            />
                            <span className="min-w-0 flex-1 truncate text-caption text-ink-mid">
                              <span className="text-ink-hi">
                                {tr.artist ?? '?'} — {tr.title ?? '?'}
                              </span>{' '}
                              <span className="text-ink-lo">({tr.path ?? tp('noFile')})</span>
                            </span>
                            <span className="shrink-0 font-mono text-caption tabular-nums text-ink-lo">
                              {tr.filesize !== null ? formatBytes(tr.filesize) : ''}
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="space-y-3 border-t border-line-subtle pt-3">
                  <PathField
                    label={tp('fQuarantine')}
                    value={quarantineDir}
                    onBrowse={async () => {
                      const d = await window.crateforge.dialog.openDirectory();
                      if (d) setQuarantineDir(d);
                    }}
                  />
                  <SaveTargetNotice target="copy" />
                  <Button
                    variant="destructive"
                    size="lg"
                    disabled={selected.size === 0 || !quarantineDir || busy}
                    onClick={() => setConfirmOpen(true)}
                  >
                    <CopyX /> {tp('moveBtn', { n: selected.size, size: formatBytes(selectedBytes) })}
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {outcome && <Notice variant="success">{outcome}</Notice>}
      {error && <Notice variant="destructive">{error}</Notice>}

      <DangerConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={tp('qTitle')}
        confirmWord="SPOSTA"
        confirmLabel={tp('qLabel', { n: selected.size })}
        onConfirm={doQuarantine}
        facts={[
          { label: tp('factFiles'), value: selected.size.toLocaleString(locale) },
          { label: tp('factSize'), value: formatBytes(selectedBytes) },
          { label: tp('factDest'), value: shortenPath(quarantineDir, 34) }
        ]}
        description={<p>{tp('qBody2')}</p>}
      />
    </div>
  );
}

/* -------------------------------------------------------------- Quarantena */

interface QuarantineFolder {
  dir: string;
  entries: {
    from: string;
    to: string;
    at: string;
    present: boolean;
    originFree: boolean;
    size: number | null;
  }[];
}

function QuarantineTab() {
  const { locale } = useAppState();
  const tp = (k: string, p?: Record<string, string | number>) =>
    pageText(locale, 'quarantine', k, p);
  const { push } = useNotifications();
  const [root, setRoot] = useState('');
  const [folders, setFolders] = useState<QuarantineFolder[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);

  const load = useCallback(async (dir: string) => {
    if (!dir) return;
    setBusy(true);
    try {
      setFolders((await window.crateforge.quarantine.list(dir)) as QuarantineFolder[]);
      setSelected(new Set());
    } finally {
      setBusy(false);
    }
  }, []);

  const pickRoot = async () => {
    const d = await window.crateforge.dialog.openDirectory();
    if (d) {
      setRoot(d);
      load(d);
    }
  };

  const restore = async (folder: QuarantineFolder) => {
    const files = folder.entries.filter((e) => selected.has(e.to)).map((e) => e.to);
    if (files.length === 0) return;
    setBusy(true);
    try {
      const r = await window.crateforge.quarantine.restore(folder.dir, files, false);
      const text = tp('restored', { n: r.restored, skipped: r.skipped.length });
      setOutcome(text);
      push({ kind: 'success', title: tp('title'), body: text });
      await load(root);
    } finally {
      setBusy(false);
    }
  };

  const total = folders?.reduce((s, f) => s + f.entries.filter((e) => e.present).length, 0) ?? 0;

  return (
    <div className="space-y-4">
      <Notice variant="info" title={tp('whatTitle')}>
        {tp('whatBody')}
      </Notice>

      <Card>
        <CardHeader>
          <CardTitle className="text-body font-semibold">{tp('pickTitle')}</CardTitle>
          <CardDescription>{tp('pickDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <PathField label={tp('fRoot')} value={root} onBrowse={pickRoot} />
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => load(root)} disabled={!root} working={busy}>
              <FolderSearch /> {tp('reload')}
            </Button>
            {root && (
              <Button
                variant="ghost"
                onClick={() => window.crateforge.shell.showFolder(root)}
              >
                <FolderOpen /> {tp('openFolder')}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {folders && folders.length === 0 && (
        <EmptyState
          tone="success"
          icon={<ShieldCheck />}
          title={tp('emptyTitle')}
          action={
            <Button variant="secondary" onClick={pickRoot}>
              <FolderSearch /> {tp('emptyAction')}
            </Button>
          }
        >
          {tp('emptyBody')}
        </EmptyState>
      )}

      {folders && folders.length > 0 && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <StatTile label={tp('statFolders')} value={folders.length.toLocaleString(locale)} />
            <StatTile label={tp('statFiles')} value={total.toLocaleString(locale)} />
            <StatTile
              label={tp('statSelected')}
              value={selected.size.toLocaleString(locale)}
              tone={selected.size > 0 ? 'accent' : 'neutral'}
            />
          </div>

          {folders.map((f) => (
            <Card key={f.dir}>
              <CardHeader>
                <CardTitle className="text-body font-semibold">{shortenPath(f.dir, 60)}</CardTitle>
                <CardDescription>
                  {tp('folderLine', { n: f.entries.length.toLocaleString(locale) })}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="max-h-72 overflow-auto rounded-card border border-line-subtle">
                  {f.entries.map((e) => (
                    <label
                      key={e.to}
                      className={cnRow(e.present)}
                    >
                      <Checkbox
                        disabled={!e.present || !e.originFree}
                        checked={selected.has(e.to)}
                        onCheckedChange={() =>
                          setSelected((prev) => {
                            const next = new Set(prev);
                            next.has(e.to) ? next.delete(e.to) : next.add(e.to);
                            return next;
                          })
                        }
                      />
                      <span className="min-w-0 flex-1 truncate text-caption text-ink-mid" title={e.from}>
                        {e.from}
                      </span>
                      {!e.originFree && (
                        <span className="shrink-0 text-caption text-warning">
                          {tp('originOccupied')}
                        </span>
                      )}
                      {!e.present && (
                        <span className="shrink-0 text-caption text-ink-lo">{tp('missing')}</span>
                      )}
                      <span className="shrink-0 font-mono text-caption tabular-nums text-ink-lo">
                        {e.size !== null ? formatBytes(e.size) : '—'}
                      </span>
                    </label>
                  ))}
                </div>
                <Button
                  variant="primary"
                  onClick={() => restore(f)}
                  disabled={selected.size === 0}
                  working={busy}
                >
                  <RotateCcw /> {tp('restoreBtn', { n: selected.size })}
                </Button>
              </CardContent>
            </Card>
          ))}
        </>
      )}

      {outcome && <Notice variant="success">{outcome}</Notice>}
    </div>
  );
}

function cnRow(present: boolean): string {
  return [
    'flex cursor-pointer items-center gap-2.5 border-b border-line-subtle px-3 py-1.5',
    'transition-colors duration-press last:border-b-0 hover:bg-surface-hover',
    present ? '' : 'opacity-50'
  ].join(' ');
}
