import { useEffect, useMemo, useState } from 'react';
import { Copy } from 'lucide-react';
import { Sheet } from '@/components/ui/sheet';
import { EmptyState, Notice } from '@/components/ui/misc';
import { Button } from '@/components/ui/button';
import { useJobs } from '@/lib/jobs';
import { useLibrary } from '@/lib/library';
import { useT } from '@/lib/strings';
import { formatBytes, shortenPath } from '@/lib/utils';
import { CheckRow, toggleIn, trackName } from './parts';
import { QuarantineMove } from './QuarantineMove';

/**
 * Doppioni: il confronto parte da solo all'apertura. Per ogni gruppo resta
 * spuntato da togliere tutto tranne il file più grande, che di solito è la
 * copia migliore; chi non è d'accordo cambia la spunta. Niente sparisce: va
 * in quarantena, dopo una conferma.
 */

interface DupTrack {
  id: number;
  title: string | null;
  artist: string | null;
  path: string | null;
  filesize: number | null;
}

interface DupGroup {
  acousticId: string;
  tracks: DupTrack[];
}

export function DuplicatesSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useT();
  const { run } = useJobs();
  const { refresh } = useLibrary();
  const [groups, setGroups] = useState<DupGroup[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setGroups(null);
    setError(null);
    void run(t('dup.run'), () => window.crateforge.dedup.run())
      .then((r) => {
        const res = r as { ok: boolean; message?: string; groups?: DupGroup[] };
        if (!res.ok) {
          setError(res.message ?? t('c.error'));
          return;
        }
        const gs = res.groups ?? [];
        setGroups(gs);
        const pre = new Set<string>();
        for (const g of gs) {
          const keep = [...g.tracks].sort((a, b) => (b.filesize ?? 0) - (a.filesize ?? 0))[0];
          for (const tr of g.tracks) if (tr.path && tr !== keep) pre.add(tr.path);
        }
        setSelected(pre);
        void refresh();
      })
      .catch((e) => setError(String(e)));
  }, [open, run, t, refresh]);

  const bytes = useMemo(() => {
    let sum = 0;
    for (const g of groups ?? []) for (const tr of g.tracks) if (tr.path && selected.has(tr.path)) sum += tr.filesize ?? 0;
    return sum;
  }, [groups, selected]);

  const onMoved = (moved: string[]) => {
    const gone = new Set(moved);
    setGroups((prev) =>
      (prev ?? [])
        .map((g) => ({ ...g, tracks: g.tracks.filter((tr) => !tr.path || !gone.has(tr.path)) }))
        .filter((g) => g.tracks.length > 1)
    );
    setSelected(new Set());
    void refresh();
  };

  return (
    <Sheet
      wide
      open={open}
      onOpenChange={onOpenChange}
      title={t('fix.i.duplicates')}
      icon={<Copy />}
      footer={
        groups && groups.length > 0 ? (
          <QuarantineMove files={[...selected]} bytes={bytes} onMoved={onMoved} />
        ) : undefined
      }
    >
      {error && <Notice variant="destructive">{error}</Notice>}
      {groups === null && !error && <p className="text-body text-ink-mid">{t('c.working')}</p>}
      {groups && groups.length === 0 && (
        <EmptyState
          tone="success"
          icon={<Copy />}
          title={t('dup.none')}
          action={<Button variant="secondary" onClick={() => onOpenChange(false)}>{t('c.close')}</Button>}
        />
      )}
      {groups && groups.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-body font-medium text-ink-hi">{t('dup.groups', { n: groups.length })}</span>
            <span className="text-caption text-ink-lo">{t('dup.hint')}</span>
          </div>
          {groups.map((g) => (
            <div key={g.acousticId} className="divide-y divide-line-subtle rounded-card border border-line-subtle">
              {g.tracks.map((tr) => {
                const on = !!tr.path && selected.has(tr.path);
                return (
                  <CheckRow
                    key={tr.id}
                    checked={on}
                    disabled={!tr.path}
                    onToggle={() => tr.path && setSelected((s) => toggleIn(s, tr.path!))}
                    aside={
                      <>
                        {!on && tr.path && (
                          <span className="rounded-chip bg-success/15 px-1.5 text-caption text-success">{t('dup.keep')}</span>
                        )}
                        <span className="w-16 text-right font-mono text-caption tabular-nums text-ink-lo">
                          {tr.filesize ? formatBytes(tr.filesize) : '—'}
                        </span>
                      </>
                    }
                  >
                    <span>{trackName(tr)}</span>
                    <span className="ml-2 font-mono text-caption text-ink-lo">{tr.path ? shortenPath(tr.path, 60) : ''}</span>
                  </CheckRow>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </Sheet>
  );
}
