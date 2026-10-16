import { useEffect, useState } from 'react';
import { CheckCircle2, FolderOpen, HardDriveDownload, Music } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox, Notice } from '@/components/ui/misc';
import { Figure, InfoTip, PageHeader, Section } from '@/components/ui/page';
import { useRememberedDir } from '@/components/ui/fields';
import { useAppState } from '@/lib/appState';
import { useJobs } from '@/lib/jobs';
import { useLibrary } from '@/lib/library';
import { useNotifications } from '@/lib/notifications';
import { useT } from '@/lib/strings';
import { formatBytes, shortenPath } from '@/lib/utils';

/**
 * Backup: due cartelle, «Controlla», «Fai il backup».
 *
 * Le cartelle restano ricordate; la libreria di Rekordbox si include da sola
 * quando il database è nella posizione di sistema. La prima volta si copia
 * tutto, poi solo ciò che è nuovo o cambiato: il controllo lo dice in numeri
 * prima di scrivere qualsiasi cosa.
 */

interface Plan {
  planId: string;
  scannedFiles: number;
  toCopy: number;
  totalBytes: number;
  dbSnapshotDir: string | null;
  preview: { src: string; reason: string }[];
}

export function BackupScreen() {
  const t = useT();
  const { locale } = useAppState();
  const { run } = useJobs();
  const { push } = useNotifications();
  const { rbPaths } = useLibrary();
  const [musicDir, pickMusic] = useRememberedDir('musicDir');
  const [backupDir, pickBackup] = useRememberedDir('backupDir');
  const [withRb, setWithRb] = useState(true);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setPlan(null), [musicDir, backupDir, withRb]);

  const rbAvailable = !!rbPaths?.masterDbExists;

  const check = async () => {
    setBusy(true);
    setError(null);
    try {
      const p = (await run(t('bak.check'), () =>
        window.crateforge.backup.plan({
          musicDir,
          backupDir,
          masterDbPath: withRb && rbAvailable ? rbPaths!.masterDb : undefined,
          optionsJsonPath: withRb && rbPaths?.optionsJsonExists ? rbPaths.optionsJson : undefined
        })
      )) as Plan;
      setPlan(p);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const execute = async () => {
    if (!plan) return;
    setBusy(true);
    try {
      const r = (await run(t('bak.run'), () => window.crateforge.backup.execute(plan.planId))) as {
        copied: number;
        dbSnapshotDir: string | null;
        failed: unknown[];
      };
      push({
        kind: r.failed.length ? 'warning' : 'success',
        job: true,
        title: t('bak.done', { n: r.copied.toLocaleString(locale) }),
        body: r.failed.length ? t('bak.failed', { n: r.failed.length }) : backupDir
      });
      setPlan(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const folder = (icon: React.ReactNode, label: string, value: string, pick: () => void, tip?: string) => (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1 text-caption text-ink-mid">
        {label} {tip && <InfoTip text={tip} />}
      </div>
      <button
        onClick={pick}
        className="flex w-full items-center gap-3 rounded-card border border-line-subtle bg-surface-1 px-4 py-3 text-left transition-colors duration-press hover:border-line-strong hover:bg-surface-hover"
      >
        <span className="text-ink-lo [&_svg]:size-[18px]">{icon}</span>
        <span className={value ? 'min-w-0 flex-1 truncate font-mono text-caption text-ink-hi' : 'flex-1 text-body text-ink-lo'}>
          {value ? shortenPath(value, 60) : t('c.choose')}
        </span>
        <FolderOpen className="size-4 text-ink-lo" />
      </button>
    </div>
  );

  const n = (v: number) => v.toLocaleString(locale);

  return (
    <div className="space-y-6">
      <PageHeader title={t('nav.backup')} />

      <Section>
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            {folder(<Music />, t('bak.music'), musicDir, () => void pickMusic())}
            {folder(<HardDriveDownload />, t('bak.dest'), backupDir, () => void pickBackup(), t('bak.destTip'))}
          </div>
          {rbAvailable && (
            <label className="flex cursor-pointer items-center gap-2.5 text-body text-ink-hi">
              <Checkbox checked={withRb} onCheckedChange={(v) => setWithRb(v === true)} />
              {t('bak.withRb')}
            </label>
          )}
          {error && <Notice variant="destructive">{error}</Notice>}
          <div className="flex gap-2">
            {plan && plan.toCopy > 0 ? (
              <Button size="lg" variant="primary" working={busy} onClick={execute}>
                <HardDriveDownload /> {t('bak.run')}
              </Button>
            ) : (
              <Button size="lg" variant="primary" disabled={!musicDir || !backupDir} working={busy} onClick={check}>
                {t('bak.check')}
              </Button>
            )}
          </div>
        </div>
      </Section>

      {plan && (
        <>
          {plan.toCopy === 0 && !plan.dbSnapshotDir ? (
            <Notice variant="success" icon={<CheckCircle2 />}>
              {t('bak.upToDate')}
            </Notice>
          ) : null}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <Figure value={n(plan.toCopy)} label={`${t('bak.toCopy')} · ${formatBytes(plan.totalBytes)}`} tone={plan.toCopy ? 'warning' : 'good'} />
            <Figure value={n(Math.max(0, plan.scannedFiles - plan.toCopy))} label={t('bak.already')} />
            <Figure value={plan.dbSnapshotDir ? t('c.yes') : t('c.no')} label={t('bak.db')} tone={plan.dbSnapshotDir ? 'good' : 'default'} />
          </div>
          {plan.preview.length > 0 && (
            <Section title={t('bak.toCopy')}>
              <ul className="space-y-0.5 font-mono text-caption text-ink-mid">
                {plan.preview.slice(0, 12).map((p) => (
                  <li key={p.src} className="truncate">
                    {shortenPath(p.src, 100)}
                  </li>
                ))}
                {plan.toCopy > 12 && <li className="text-ink-lo">{t('bak.more', { n: n(plan.toCopy - 12) })}</li>}
              </ul>
            </Section>
          )}
        </>
      )}
    </div>
  );
}
