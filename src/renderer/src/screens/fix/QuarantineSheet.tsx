import { useCallback, useEffect, useState } from 'react';
import { Archive, ExternalLink, FolderOpen, Undo2 } from 'lucide-react';
import { Sheet } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/misc';
import { useRememberedDir } from '@/components/ui/fields';
import { useNotifications } from '@/lib/notifications';
import { useT } from '@/lib/strings';
import { formatBytes, shortenPath } from '@/lib/utils';
import { CheckRow, RowList, toggleIn } from './parts';

/** Quarantena: che cosa c'è dentro, e rimetterlo al suo posto. */

interface Entry {
  from: string;
  to: string;
  at: string;
  present: boolean;
  originFree: boolean;
  size: number | null;
}

interface Folder {
  dir: string;
  entries: Entry[];
}

export function QuarantineSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useT();
  const { push } = useNotifications();
  const [root, pickRoot] = useRememberedDir('quarantineDir');
  const [folders, setFolders] = useState<Folder[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (dir: string) => {
    if (!dir) return;
    const fs = (await window.crateforge.quarantine.list(dir)) as Folder[];
    setFolders(fs);
    setSelected(new Set());
  }, []);

  useEffect(() => {
    if (open && root) void load(root);
  }, [open, root, load]);

  const restore = async () => {
    setBusy(true);
    try {
      let restored = 0;
      let skipped = 0;
      for (const f of folders ?? []) {
        const files = f.entries.filter((e) => selected.has(e.to)).map((e) => e.to);
        if (files.length === 0) continue;
        const r = await window.crateforge.quarantine.restore(f.dir, files, false);
        restored += r.restored;
        skipped += r.skipped.length;
      }
      push({ kind: 'success', title: t('q.restored', { n: restored, skipped }) });
      await load(root);
    } finally {
      setBusy(false);
    }
  };

  const entries = (folders ?? []).flatMap((f) => f.entries).filter((e) => e.present);

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      wide
      title={t('fix.t.quarantine')}
      icon={<Archive />}
      footer={
        entries.length > 0 ? (
          <Button variant="primary" disabled={selected.size === 0} working={busy} onClick={restore}>
            <Undo2 /> {t('q.restore', { n: selected.size })}
          </Button>
        ) : undefined
      }
    >
      <div className="space-y-4">
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => void pickRoot()} className="min-w-0">
            <FolderOpen /> <span className="truncate">{root ? shortenPath(root, 56) : t('q.dir')}</span>
          </Button>
          {root && (
            <Button variant="ghost" onClick={() => window.crateforge.shell.showFolder(root)}>
              <ExternalLink /> {t('c.openFolder')}
            </Button>
          )}
        </div>

        {folders && entries.length === 0 && (
          <EmptyState
            tone="success"
            icon={<Archive />}
            title={t('q.empty')}
            action={<Button variant="secondary" onClick={() => onOpenChange(false)}>{t('c.close')}</Button>}
          />
        )}

        {entries.length > 0 && (
          <RowList>
            {entries.map((e) => (
              <CheckRow
                key={e.to}
                checked={selected.has(e.to)}
                disabled={!e.originFree}
                onToggle={() => setSelected((s) => toggleIn(s, e.to))}
                aside={
                  <span className="w-20 text-right font-mono text-caption tabular-nums text-ink-lo">
                    {!e.originFree ? t('q.taken') : e.size ? formatBytes(e.size) : ''}
                  </span>
                }
              >
                <span className="font-mono text-caption">{shortenPath(e.from, 90)}</span>
              </CheckRow>
            ))}
          </RowList>
        )}
      </div>
    </Sheet>
  );
}
