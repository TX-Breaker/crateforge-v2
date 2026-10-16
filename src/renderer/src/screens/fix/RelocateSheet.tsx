import { useEffect, useState } from 'react';
import { FileSearch, FolderOpen, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet } from '@/components/ui/sheet';
import { EmptyState, Notice } from '@/components/ui/misc';
import { InfoTip } from '@/components/ui/page';
import { useJobs } from '@/lib/jobs';
import { useNotifications } from '@/lib/notifications';
import { useT } from '@/lib/strings';
import { shortenPath } from '@/lib/utils';
import { RowList, trackName } from './parts';

/**
 * File spostati: chi ha spostato la musica indica dove sta adesso, CrateForge
 * ritrova i brani e scrive un XML che Rekordbox importa. Nessuna scrittura
 * nel database di Rekordbox.
 */

interface BrokenRow {
  trackId: number;
  title: string | null;
  artist: string | null;
  oldPath: string;
}

interface MatchSummary {
  broken: number;
  matched: number;
  ambiguous: number;
  written: number;
}

export function RelocateSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useT();
  const { run } = useJobs();
  const { push } = useNotifications();
  const [broken, setBroken] = useState<BrokenRow[] | null>(null);
  const [root, setRoot] = useState('');
  const [match, setMatch] = useState<MatchSummary | null>(null);
  const [fp, setFp] = useState<{ matched: number; broken: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setBroken(null);
    setMatch(null);
    setFp(null);
    setError(null);
    void run(t('fix.t.relocate'), () => window.crateforge.relocator.findBroken())
      .then((r) => setBroken(r as BrokenRow[]))
      .catch((e) => setError(String(e)));
  }, [open, run, t]);

  const pick = async () => {
    const d = (await window.crateforge.dialog.openDirectory()) as string | null;
    if (!d) return;
    setRoot(d);
    setMatch(null);
    setFp(null);
    setBusy(true);
    try {
      setMatch((await run(t('rel.match'), () => window.crateforge.relocator.matchAndWrite(d, null))) as MatchSummary);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const write = async () => {
    const out = (await window.crateforge.dialog.saveFile('crateforge-relocation.xml', [
      { name: 'Rekordbox XML', extensions: ['xml'] }
    ])) as string | null;
    if (!out) return;
    const r = (await run(t('rel.write'), () => window.crateforge.relocator.matchAndWrite(root, out))) as MatchSummary;
    push({ kind: 'success', job: true, title: t('rel.written', { n: r.written }), body: out });
  };

  const byFingerprint = async () => {
    setBusy(true);
    try {
      const r = (await run(t('rel.fp'), () => window.crateforge.relocatorFp.match(root))) as {
        ok: boolean;
        message?: string;
        matched: number;
        broken: number;
      };
      if (!r.ok) setError(r.message ?? t('c.error'));
      else setFp({ matched: r.matched, broken: r.broken });
    } finally {
      setBusy(false);
    }
  };

  const writeFp = async () => {
    const out = (await window.crateforge.dialog.saveFile('crateforge-relocation-fp.xml', [
      { name: 'Rekordbox XML', extensions: ['xml'] }
    ])) as string | null;
    if (!out) return;
    const r = (await run(t('rel.write'), () => window.crateforge.relocatorFp.writeXml(out))) as { written: number };
    push({ kind: 'success', job: true, title: t('rel.written', { n: r.written }), body: out });
  };

  const leftover = match ? match.broken - match.matched : 0;

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t('fix.t.relocate')}
      icon={<FileSearch />}
      footer={
        match && match.matched > 0 ? (
          <Button variant="primary" onClick={write}>
            <Save /> {t('rel.write')}
          </Button>
        ) : undefined
      }
    >
      {error && <Notice variant="destructive">{error}</Notice>}
      {broken === null && !error && <p className="text-body text-ink-mid">{t('c.loading')}</p>}
      {broken && broken.length === 0 && (
        <EmptyState tone="success" icon={<FileSearch />} title={t('rel.none')} action={
          <Button variant="secondary" onClick={() => onOpenChange(false)}>{t('c.close')}</Button>
        } />
      )}
      {broken && broken.length > 0 && (
        <div className="space-y-5">
          <div className="space-y-2">
            <div className="text-body font-medium text-ink-hi">{t('rel.broken', { n: broken.length })}</div>
            <RowList className="max-h-48">
              {broken.slice(0, 200).map((b) => (
                <div key={b.trackId} className="px-3 py-1.5">
                  <div className="truncate text-body text-ink-hi">{trackName(b)}</div>
                  <div className="truncate font-mono text-caption text-ink-lo">{shortenPath(b.oldPath, 70)}</div>
                </div>
              ))}
            </RowList>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-body font-medium text-ink-hi">
              {t('rel.where')} <InfoTip text={t('rel.how')} />
            </div>
            <Button variant={root ? 'secondary' : 'primary'} onClick={pick} working={busy && !match}>
              <FolderOpen /> {root ? shortenPath(root, 48) : t('c.choose')}
            </Button>
          </div>

          {match && (
            <Notice variant={match.matched > 0 ? 'success' : 'warning'}>
              {t('rel.result', { matched: match.matched, ambiguous: match.ambiguous })}
            </Notice>
          )}

          {match && leftover > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Button variant="secondary" onClick={byFingerprint} working={busy}>
                  {t('rel.fp')}
                </Button>
                <InfoTip text={t('rel.fpTip')} />
              </div>
              {fp && (
                <div className="flex items-center gap-3">
                  <span className="text-body text-ink-mid">
                    {t('rel.fpResult', { matched: fp.matched, broken: fp.broken })}
                  </span>
                  {fp.matched > 0 && (
                    <Button size="sm" variant="secondary" onClick={writeFp}>
                      <Save /> {t('rel.write')}
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Sheet>
  );
}
