import { useCallback, useEffect, useState } from 'react';
import { FileX2, FolderSync, PackageOpen, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, StatTile } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge, Checkbox, EmptyState, Notice, Switch } from '@/components/ui/misc';
import { PathField } from '@/components/ui/fields';
import { SaveTargetNotice } from '@/components/SaveTargetNotice';
import { RekordboxDiff } from '@/components/RekordboxDiff';
import { useAppState } from '@/lib/appState';
import { useLibrary } from '@/lib/library';
import { useNotifications } from '@/lib/notifications';
import { pageText } from '@/lib/i18nPages';
import { formatClock } from '@/lib/utils';

interface InboxItem {
  id: number;
  path: string;
  title: string | null;
  artist: string | null;
  bpm: number | null;
  camelot: string | null;
  version_label: string | null;
  has_tag_issues: number;
  added_at: string;
}

/**
 * Nuovi acquisti (Esperto). Onestà tecnica, invariata dalla V1: la cartella è
 * sorvegliata SOLO mentre CrateForge è aperto, e non viene iniettato nulla in
 * Rekordbox — si prepara un XML che l'utente importa a mano.
 */
export function ArrivalsPage() {
  const { locale } = useAppState();
  const tp = (k: string, p?: Record<string, string | number>) => pageText(locale, 'inbox', k, p);
  const { refreshArrivals } = useLibrary();
  const { push } = useNotifications();

  const [folder, setFolder] = useState('');
  const [running, setRunning] = useState(false);
  const [items, setItems] = useState<InboxItem[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const st = await window.crateforge.watcher.status();
    setRunning(st.running);
    if (st.folder) setFolder(st.folder);
    const list = (await window.crateforge.inbox.list('new')) as InboxItem[];
    setItems(list);
    setSelected(new Set(list.filter((i) => i.has_tag_issues === 0).map((i) => i.id)));
    refreshArrivals();
  }, [refreshArrivals]);

  useEffect(() => {
    refresh();
    const off = window.crateforge.watcher.onNewItems(() => refresh());
    return off;
  }, [refresh]);

  const toggleDaemon = async (on: boolean) => {
    setError(null);
    setBusy(true);
    try {
      if (on) {
        if (!folder) {
          setError(tp('needFolder'));
          return;
        }
        const r = await window.crateforge.watcher.start(folder);
        setMessage(tp('startLine', { n: r.added }));
      } else {
        await window.crateforge.watcher.stop();
        setMessage(tp('stopLine'));
      }
      await refresh();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const doScan = async () => {
    if (!folder) return;
    setBusy(true);
    try {
      const r = (await window.crateforge.watcher.scan(folder)) as { added: number };
      setMessage(tp('scanLine', { n: r.added }));
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const doPrepare = async () => {
    const outPath = await window.crateforge.dialog.saveFile('crateforge-nuovi-acquisti.xml', [
      { name: 'Rekordbox XML', extensions: ['xml'] }
    ]);
    if (!outPath) return;
    setBusy(true);
    try {
      const r = await window.crateforge.inbox.prepareXml([...selected], outPath);
      const text = tp('outPrepared', {
        n: r.written,
        excluded: r.excludedForIssues > 0 ? tp('outExcluded', { n: r.excludedForIssues }) : ''
      });
      setMessage(text);
      push({ kind: 'success', title: tp('title'), body: text });
      await refresh();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const doDismiss = async () => {
    await window.crateforge.inbox.setStatus([...selected], 'dismissed');
    setMessage(tp('outDismissed', { n: selected.size }));
    await refresh();
  };

  return (
    <div className="space-y-4">
      <Notice variant="warning" title={tp('warnTitle')}>
        {tp('warnBody')}
      </Notice>
      <RekordboxDiff page="inbox" />

      <Card>
        <CardHeader>
          <CardTitle className="text-body">{tp('folderTitle')}</CardTitle>
          <CardDescription>{tp('folderDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <PathField
            label={tp('fFolder')}
            value={folder}
            onBrowse={async () => {
              const d = await window.crateforge.dialog.openDirectory();
              if (d) setFolder(d);
            }}
          />
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2.5 text-body text-ink-mid">
              <Switch
                checked={running}
                onCheckedChange={toggleDaemon}
                disabled={busy || (!folder && !running)}
              />
              <span className={running ? 'text-success' : ''}>
                {running ? tp('watching') : tp('notWatching')}
              </span>
            </label>
            <Button variant="secondary" size="sm" onClick={doScan} disabled={!folder} working={busy}>
              <RefreshCw /> {tp('scanBtn')}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-body">{tp('queueTitle', { n: items.length })}</CardTitle>
          <CardDescription>{tp('queueDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {items.length === 0 ? (
            <EmptyState icon={<FolderSync />} title={tp('emptyTitle')}>
              {tp('emptyBody')}
            </EmptyState>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <StatTile label={tp('statNew')} value={items.length.toLocaleString(locale)} />
                <StatTile
                  label={tp('statSelected')}
                  value={selected.size.toLocaleString(locale)}
                  tone="accent"
                />
                <StatTile
                  label={tp('statIssues')}
                  value={items.filter((i) => i.has_tag_issues === 1).length.toLocaleString(locale)}
                  tone="warning"
                />
              </div>

              <div className="max-h-96 overflow-auto rounded-card border border-line-subtle">
                {items.map((i) => (
                  <label
                    key={i.id}
                    className="flex cursor-pointer items-center gap-2.5 border-b border-line-subtle px-3 py-1.5 transition-colors duration-press last:border-b-0 hover:bg-surface-hover"
                  >
                    <Checkbox
                      checked={selected.has(i.id)}
                      onCheckedChange={() =>
                        setSelected((prev) => {
                          const next = new Set(prev);
                          next.has(i.id) ? next.delete(i.id) : next.add(i.id);
                          return next;
                        })
                      }
                    />
                    <span className="min-w-0 flex-1 truncate text-caption text-ink-mid" title={i.path}>
                      <span className="text-ink-hi">
                        {i.artist ?? '?'} — {i.title ?? '?'}
                      </span>
                    </span>
                    {i.has_tag_issues === 1 && (
                      <Badge variant="warning">{tp('tagIssues')}</Badge>
                    )}
                    <span className="shrink-0 font-mono text-caption tabular-nums text-ink-lo">
                      {i.bpm ? i.bpm.toFixed(1) : '—'} · {i.camelot ?? '—'}
                    </span>
                    <span className="shrink-0 font-mono text-caption tabular-nums text-ink-lo">
                      {formatClock(i.added_at)}
                    </span>
                  </label>
                ))}
              </div>

              <SaveTargetNotice target="xml" />

              <div className="flex flex-wrap gap-2">
                <Button variant="primary" onClick={doPrepare} disabled={selected.size === 0} working={busy}>
                  <PackageOpen /> {tp('prepareBtn', { n: selected.size })}
                </Button>
                <Button variant="ghost" onClick={doDismiss} disabled={selected.size === 0 || busy}>
                  <FileX2 /> {tp('dismissBtn')}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {message && <Notice variant="success">{message}</Notice>}
      {error && <Notice variant="destructive">{error}</Notice>}
    </div>
  );
}
