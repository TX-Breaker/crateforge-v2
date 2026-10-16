import { useState } from 'react';
import { Archive, FolderOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DangerConfirmDialog } from '@/components/DangerConfirmDialog';
import { useRememberedDir } from '@/components/ui/fields';
import { useJobs } from '@/lib/jobs';
import { useNotifications } from '@/lib/notifications';
import { useT } from '@/lib/strings';
import { formatBytes, shortenPath } from '@/lib/utils';

/**
 * «Sposta in quarantena» con la sua conferma a parola chiave. Usato da
 * Doppioni e da File fuori libreria: stessa azione, stesso controllo.
 * La cartella della quarantena si sceglie una volta e resta ricordata.
 */
export function QuarantineMove({
  files,
  bytes,
  onMoved
}: {
  files: string[];
  bytes: number;
  onMoved: (moved: string[]) => void;
}) {
  const t = useT();
  const { run } = useJobs();
  const { push } = useNotifications();
  const [dir, pickDir] = useRememberedDir('quarantineDir');
  const [confirm, setConfirm] = useState(false);

  const ask = async () => {
    if (!dir && !(await pickDir())) return;
    setConfirm(true);
  };

  const move = async () => {
    const r = (await run(t('q.move', { n: files.length }), () =>
      window.crateforge.orphans.quarantine(files, dir, false)
    )) as { moved: number; quarantineDir: string; failed: { path: string }[] };
    push({ kind: 'success', job: true, title: t('q.moved', { n: r.moved }), body: r.quarantineDir });
    const failed = new Set(r.failed.map((f) => f.path));
    onMoved(files.filter((f) => !failed.has(f)));
  };

  return (
    <>
      <div className="flex min-w-0 items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => void pickDir()} title={t('q.dir')}>
          <FolderOpen /> <span className="max-w-[180px] truncate">{dir ? shortenPath(dir, 28) : t('q.dir')}</span>
        </Button>
        <Button variant="primary" disabled={files.length === 0} onClick={ask}>
          <Archive /> {t('q.move', { n: files.length })}
        </Button>
      </div>
      <DangerConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t('q.confirmTitle', { n: files.length })}
        description={t('q.confirmBody')}
        facts={[
          { label: t('c.selected', { n: files.length }), value: formatBytes(bytes) },
          { label: t('q.dir'), value: shortenPath(dir, 40) }
        ]}
        confirmWord="SPOSTA"
        confirmLabel={t('q.confirmBtn')}
        onConfirm={move}
      />
    </>
  );
}
