import { useState } from 'react';
import { FolderOpen, Layers, Search } from 'lucide-react';
import { Sheet } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input, Notice } from '@/components/ui/misc';
import { useRememberedDir } from '@/components/ui/fields';
import { useJobs } from '@/lib/jobs';
import { useLibrary } from '@/lib/library';
import { useNotifications } from '@/lib/notifications';
import { useT } from '@/lib/strings';
import { cn, shortenPath } from '@/lib/utils';
import { RowList, trackName } from './parts';

/** Separazione in tracce: un brano, una cartella, un pulsante. */

interface TrackRow {
  id: number;
  title: string | null;
  artist: string | null;
  path: string | null;
}

export function StemsSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useT();
  const { run } = useJobs();
  const { push } = useNotifications();
  const { sidecar } = useLibrary();
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<TrackRow[]>([]);
  const [track, setTrack] = useState<TrackRow | null>(null);
  const [outDir, pickOut] = useRememberedDir('stemsDir');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const doSearch = async () => {
    const r = (await window.crateforge.library.page({ offset: 0, limit: 30, search })) as { rows: TrackRow[] };
    setRows(r.rows.filter((x) => x.path));
  };

  const split = async () => {
    if (!track) return;
    const dir = outDir || (await pickOut());
    if (!dir) return;
    setBusy(true);
    setError(null);
    try {
      const r = (await run(t('fix.t.stems'), () => window.crateforge.stems.run(track.id, dir))) as {
        ok: boolean;
        message?: string;
        outDir?: string;
      };
      if (!r.ok) setError(r.message ?? t('c.error'));
      else push({ kind: 'success', job: true, title: t('stem.done'), body: r.outDir ?? dir });
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const engineDown = sidecar !== null && !sidecar.available;

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t('fix.t.stems')}
      icon={<Layers />}
      footer={
        <>
          <span className="mr-auto text-caption text-ink-lo">{t('stem.slow')}</span>
          <Button variant="primary" disabled={!track || engineDown} working={busy} onClick={split}>
            <Layers /> {t('stem.run')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {engineDown && <Notice variant="warning">{t('cue.engine')}</Notice>}
        {error && <Notice variant="destructive">{error}</Notice>}
        <div className="space-y-1.5">
          <div className="text-caption text-ink-mid">{t('stem.track')}</div>
          <div className="flex gap-2">
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
        </div>
        {rows.length > 0 && (
          <RowList className="max-h-64">
            {rows.map((r) => (
              <button
                key={r.id}
                onClick={() => setTrack(r)}
                className={cn(
                  'block w-full truncate px-3 py-2 text-left text-body transition-colors duration-press hover:bg-surface-hover',
                  track?.id === r.id ? 'bg-accent/10 text-ink-hi' : 'text-ink-mid'
                )}
              >
                {trackName(r)}
              </button>
            ))}
          </RowList>
        )}
        <div className="space-y-1.5">
          <div className="text-caption text-ink-mid">{t('stem.out')}</div>
          <Button variant="secondary" onClick={() => void pickOut()} className="min-w-0">
            <FolderOpen /> <span className="truncate">{outDir ? shortenPath(outDir, 56) : t('c.choose')}</span>
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
