import { useEffect, useMemo, useState } from 'react';
import { FolderOpen, FolderSearch, Trash2 } from 'lucide-react';
import { Sheet } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { EmptyState, Notice } from '@/components/ui/misc';
import { InfoTip } from '@/components/ui/page';
import { DangerConfirmDialog } from '@/components/DangerConfirmDialog';
import { useRememberedDir } from '@/components/ui/fields';
import { useJobs } from '@/lib/jobs';
import { useNotifications } from '@/lib/notifications';
import { useT } from '@/lib/strings';
import { formatBytes, shortenPath } from '@/lib/utils';
import { CheckRow, RowList, SelectBar, toggleIn } from './parts';
import { QuarantineMove } from './QuarantineMove';

/**
 * File fuori libreria: audio nella cartella della musica che nessuna libreria
 * importata usa. Si spostano in quarantena; eliminarli richiede le scritture
 * dirette attive e la parola chiave, come prima.
 */

interface Orphan {
  path: string;
  size: number;
}

interface ScanResult {
  orphans: Orphan[];
  reclaimableBytes: number;
  scanId: string;
}

export function OrphansSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useT();
  const { run } = useJobs();
  const { push } = useNotifications();
  const [musicDir, pickMusicDir] = useRememberedDir('musicDir');
  const [result, setResult] = useState<ScanResult | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [directWrites, setDirectWrites] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) void window.crateforge.settings.get('directWrites').then((v) => setDirectWrites(v === '1'));
  }, [open]);

  const scan = async (dir = musicDir) => {
    if (!dir) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r = (await run(t('orph.scan'), () => window.crateforge.orphans.scan(dir))) as ScanResult;
      setResult(r);
      setSelected(new Set(r.orphans.map((o) => o.path)));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const pickAndScan = async () => {
    const d = await pickMusicDir();
    if (d) await scan(d);
  };

  const bytes = useMemo(
    () => (result?.orphans ?? []).reduce((s, o) => s + (selected.has(o.path) ? o.size : 0), 0),
    [result, selected]
  );

  const drop = (files: string[]) => {
    const gone = new Set(files);
    setResult((p) => (p ? { ...p, orphans: p.orphans.filter((o) => !gone.has(o.path)) } : p));
    setSelected(new Set());
  };

  const remove = async () => {
    if (!result) return;
    const files = [...selected];
    const r = (await run(t('orph.delete', { n: files.length }), () =>
      window.crateforge.orphans.remove(result.scanId, files, false)
    )) as { deleted: number; freedBytes: number; failed: { path: string }[] };
    push({
      kind: 'warning',
      job: true,
      title: t('orph.deleted', { n: r.deleted, size: formatBytes(r.freedBytes) })
    });
    const failed = new Set(r.failed.map((f) => f.path));
    drop(files.filter((f) => !failed.has(f)));
  };

  return (
    <Sheet
      wide
      open={open}
      onOpenChange={onOpenChange}
      title={t('fix.t.orphans')}
      icon={<FolderSearch />}
      footer={
        result && result.orphans.length > 0 ? (
          <div className="flex w-full flex-wrap items-center justify-end gap-2">
            {directWrites ? (
              <Button variant="ghost" disabled={selected.size === 0} onClick={() => setConfirmDelete(true)}>
                <Trash2 /> {t('orph.delete', { n: selected.size })}
              </Button>
            ) : (
              <InfoTip text={t('orph.delLocked')} />
            )}
            <QuarantineMove files={[...selected]} bytes={bytes} onMoved={drop} />
          </div>
        ) : undefined
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <div className="text-caption text-ink-mid">{t('orph.dir')}</div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={pickAndScan} className="min-w-0">
              <FolderOpen /> <span className="truncate">{musicDir ? shortenPath(musicDir, 56) : t('c.choose')}</span>
            </Button>
            {musicDir && (
              <Button variant="primary" onClick={() => scan()} working={busy}>
                {t('orph.scan')}
              </Button>
            )}
          </div>
        </div>

        {error && <Notice variant="destructive">{error}</Notice>}

        {result && result.orphans.length === 0 && (
          <EmptyState
            tone="success"
            icon={<FolderSearch />}
            title={t('orph.none')}
            action={<Button variant="secondary" onClick={pickAndScan}>{t('c.choose')}</Button>}
          />
        )}

        {result && result.orphans.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-body font-medium text-ink-hi">
                {t('orph.found', { n: result.orphans.length, size: formatBytes(result.reclaimableBytes) })}
              </span>
              <SelectBar
                count={selected.size}
                onAll={() => setSelected(new Set(result.orphans.map((o) => o.path)))}
                onNone={() => setSelected(new Set())}
              />
            </div>
            <RowList>
              {result.orphans.slice(0, 500).map((o) => (
                <CheckRow
                  key={o.path}
                  checked={selected.has(o.path)}
                  onToggle={() => setSelected((s) => toggleIn(s, o.path))}
                  aside={
                    <span className="w-16 text-right font-mono text-caption tabular-nums text-ink-lo">
                      {formatBytes(o.size)}
                    </span>
                  }
                >
                  <span className="font-mono text-caption">{shortenPath(o.path, 90)}</span>
                </CheckRow>
              ))}
            </RowList>
          </div>
        )}
      </div>

      <DangerConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t('orph.delTitle', { n: selected.size })}
        description={t('orph.delBody')}
        facts={[{ label: t('c.selected', { n: selected.size }), value: formatBytes(bytes), warn: true }]}
        confirmWord="ELIMINA"
        confirmLabel={t('orph.delBtn')}
        onConfirm={remove}
      />
    </Sheet>
  );
}
