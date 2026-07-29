import { useState } from 'react';
import { HardDriveDownload, ShieldCheck } from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Eyebrow,
  StatTile
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/misc';
import { PathField } from '@/components/ui/fields';
import { SaveTargetNotice } from '@/components/SaveTargetNotice';
import { RekordboxDiff } from '@/components/RekordboxDiff';
import { useAppState } from '@/lib/appState';
import { useJobs } from '@/lib/jobs';
import { useNotifications } from '@/lib/notifications';
import { pageText } from '@/lib/i18nPages';
import { formatBytes, shortenPath } from '@/lib/utils';

interface PlanSummary {
  planId: string;
  scannedFiles: number;
  toCopy: number;
  totalBytes: number;
  dbSnapshotDir: string | null;
  preview: { src: string; reason: string }[];
}

/**
 * Backup smart incrementale. La pagina è una sequenza in tre battute e il
 * layout lo dice: cosa verrà copiato, dove va, cosa è tornato verificato.
 * Niente parte prima che il dry-run sia stato letto.
 */
export function BackupPage() {
  const { locale } = useAppState();
  const tp = (k: string, p?: Record<string, string | number>) => pageText(locale, 'backup', k, p);
  const { run } = useJobs();
  const { push } = useNotifications();

  const [musicDir, setMusicDir] = useState('');
  const [backupDir, setBackupDir] = useState('');
  const [masterDb, setMasterDb] = useState('');
  const [optionsJson, setOptionsJson] = useState('');
  const [plan, setPlan] = useState<PlanSummary | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const pickDir = async (setter: (v: string) => void) => {
    const d = await window.crateforge.dialog.openDirectory();
    if (d) setter(d);
  };
  const pickMasterDb = async () => {
    const rb = await window.crateforge.rekordbox.defaultPaths();
    const f = await window.crateforge.dialog.openFile(
      [{ name: 'master.db', extensions: ['db'] }],
      rb.masterDbExists ? rb.masterDb : rb.dir
    );
    if (f) setMasterDb(f);
  };
  const pickOptions = async () => {
    const rb = await window.crateforge.rekordbox.defaultPaths();
    const f = await window.crateforge.dialog.openFile(
      [{ name: 'options.json', extensions: ['json'] }],
      rb.optionsJsonExists ? rb.optionsJson : rb.dir
    );
    if (f) setOptionsJson(f);
  };

  const doPlan = async () => {
    setError(null);
    setResult(null);
    setPlan(null);
    setBusy(true);
    try {
      const p = await run(tp('jobPlan'), () =>
        window.crateforge.backup.plan({
          musicDir,
          backupDir,
          masterDbPath: masterDb || undefined,
          optionsJsonPath: optionsJson || undefined
        })
      );
      setPlan(p as PlanSummary);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const doExecute = async () => {
    if (!plan) return;
    setError(null);
    setBusy(true);
    try {
      const r = await run(tp('jobRun'), () => window.crateforge.backup.execute(plan.planId));
      const text =
        tp('resDone', { copied: r.copied }) +
        (r.dbSnapshotDir ? tp('resDb', { dir: r.dbSnapshotDir }) : '') +
        (r.failed.length ? tp('resFail', { n: r.failed.length }) : '');
      setResult(text);
      setPlan(null);
      push({
        kind: r.failed.length ? 'warning' : 'success',
        job: true,
        title: tp('title'),
        body: text
      });
    } catch (err) {
      setError(String(err));
      push({ kind: 'error', job: true, title: tp('title'), body: String(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <RekordboxDiff page="backup" />

      {/* dichiarazione di destinazione PRIMA di eseguire, non solo dopo */}
      <SaveTargetNotice target="copy" />

      <Card>
        <CardHeader>
          <CardTitle className="text-body font-semibold">{tp('step1')}</CardTitle>
          <CardDescription>{tp('step1Desc')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-4 md:grid-cols-2">
            <PathField label={tp('fMusic')} value={musicDir} onBrowse={() => pickDir(setMusicDir)} />
            <PathField
              label={tp('fBackup')}
              value={backupDir}
              onBrowse={() => pickDir(setBackupDir)}
            />
            <PathField label={tp('fMasterDb')} value={masterDb} onBrowse={pickMasterDb} hint={tp('fMasterDbHint')} />
            <PathField label={tp('fOptions')} value={optionsJson} onBrowse={pickOptions} />
          </div>
          <Button variant="primary" onClick={doPlan} disabled={!musicDir || !backupDir} working={busy}>
            <ShieldCheck /> {tp('calc')}
          </Button>
        </CardContent>
      </Card>

      {plan && (
        <Card>
          <CardHeader>
            <CardTitle className="text-body font-semibold">{tp('step2')}</CardTitle>
            <CardDescription>{tp('step2Desc')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatTile
                label={tp('planToCopy')}
                value={plan.toCopy.toLocaleString(locale)}
                note={formatBytes(plan.totalBytes)}
              />
              <StatTile
                label={tp('planScanned')}
                value={plan.scannedFiles.toLocaleString(locale)}
              />
              <StatTile
                label={tp('planIdentical')}
                value={Math.max(0, plan.scannedFiles - plan.toCopy).toLocaleString(locale)}
                note={tp('planIdenticalNote')}
              />
              <StatTile
                label={tp('planSnapshot')}
                value={plan.dbSnapshotDir ? tp('yes') : tp('no')}
                tone={plan.dbSnapshotDir ? 'success' : 'neutral'}
                note={plan.dbSnapshotDir ? shortenPath(plan.dbSnapshotDir, 28) : tp('planNoDb')}
              />
            </div>

            {plan.preview.length > 0 && (
              <div>
                <Eyebrow>{tp('previewTitle')}</Eyebrow>
                <div className="mt-1.5 max-h-44 overflow-auto rounded-card border border-line-subtle bg-surface-3 p-2">
                  {plan.preview.map((i) => (
                    <div
                      key={i.src}
                      className="flex items-center gap-2 py-0.5 font-mono text-caption text-ink-mid"
                      data-selectable
                    >
                      <span className="shrink-0 rounded-chip bg-surface-hover px-1 text-[9px] uppercase tracking-wide text-ink-lo">
                        {i.reason === 'new' ? tp('reasonNew') : tp('reasonMod')}
                      </span>
                      <span className="truncate">{i.src}</span>
                    </div>
                  ))}
                  {plan.toCopy > plan.preview.length && (
                    <div className="pt-1 text-caption text-ink-lo">
                      {tp('more', {
                        n: (plan.toCopy - plan.preview.length).toLocaleString(locale)
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}

            <Button variant="primary" size="lg" onClick={doExecute} working={busy}>
              <HardDriveDownload /> {tp('run')}
            </Button>
          </CardContent>
        </Card>
      )}

      {result && <Notice variant="success" title={tp('doneTitle')}>{result}</Notice>}
      {error && (
        <Notice variant="destructive" title={tp('errTitle')}>
          {error}
        </Notice>
      )}
    </div>
  );
}
