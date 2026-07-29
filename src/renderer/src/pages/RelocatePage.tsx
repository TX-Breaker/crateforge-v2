import { useState } from 'react';
import { BookOpen, FileSearch, Fingerprint, MapPin, ShieldCheck } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Eyebrow, StatTile } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { EmptyState, Notice, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/misc';
import { PathField } from '@/components/ui/fields';
import { GuideDialog } from '@/components/GuideDialog';
import { SaveTargetNotice } from '@/components/SaveTargetNotice';
import { RekordboxDiff } from '@/components/RekordboxDiff';
import { useAppState } from '@/lib/appState';
import { useJobs } from '@/lib/jobs';
import { useRouter } from '@/lib/router';
import { pageText } from '@/lib/i18nPages';

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

/**
 * Ritrova file spostati (Esperto). Due strade, due tab:
 *   per nome file  — veloce, funziona se il file non è stato rinominato;
 *   per impronta   — ritrova anche i file RINOMINATI, se l'impronta era già
 *                    stata calcolata quando erano ancora al loro posto.
 *
 * L'esito è sempre lo stesso: un XML di aggiornamento da importare a mano.
 * Nessuna scrittura nel master.db.
 */
export function RelocatePage() {
  const { locale } = useAppState();
  const { tab, setTab } = useRouter();

  return (
    <div className="space-y-4">
      <RekordboxDiff page="relocator" />
      <Notice variant="warning" title={pageText(locale, 'relocator', 'warnTitle')}>
        {pageText(locale, 'relocator', 'warnBody')}
      </Notice>

      <Tabs value={tab ?? 'byname'} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="byname">
            <FileSearch /> {pageText(locale, 'tabs', 'byName')}
          </TabsTrigger>
          <TabsTrigger value="byfingerprint">
            <Fingerprint /> {pageText(locale, 'tabs', 'byFingerprint')}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="byname">
          <ByNameTab />
        </TabsContent>
        <TabsContent value="byfingerprint">
          <ByFingerprintTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ByNameTab() {
  const { locale } = useAppState();
  const tp = (k: string, p?: Record<string, string | number>) =>
    pageText(locale, 'relocator', k, p);
  const { run } = useJobs();
  const [broken, setBroken] = useState<BrokenRow[] | null>(null);
  const [newRoot, setNewRoot] = useState('');
  const [dryRun, setDryRun] = useState<MatchSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<{ text: string; path: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);

  const findBroken = async () => {
    setError(null);
    setOutcome(null);
    setDryRun(null);
    setBusy(true);
    try {
      setBroken((await run(tp('findBtn'), () => window.crateforge.relocator.findBroken())) as BrokenRow[]);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const doDryRun = async () => {
    setError(null);
    setBusy(true);
    try {
      setDryRun(
        (await run(tp('dryBtn'), () =>
          window.crateforge.relocator.matchAndWrite(newRoot, null)
        )) as MatchSummary
      );
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const doWrite = async () => {
    const outPath = await window.crateforge.dialog.saveFile('crateforge-relocation.xml', [
      { name: 'Rekordbox XML', extensions: ['xml'] }
    ]);
    if (!outPath) return;
    setError(null);
    setBusy(true);
    try {
      const r = await run(tp('writeBtn'), () =>
        window.crateforge.relocator.matchAndWrite(newRoot, outPath)
      );
      setOutcome({ text: tp('outDone', { n: r.written, path: outPath }), path: outPath });
      setDryRun(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-body font-semibold">{tp('step1')}</CardTitle>
          <CardDescription>{tp('step1Desc')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button variant="primary" onClick={findBroken} working={busy}>
            <FileSearch /> {tp('findBtn')}
          </Button>

          {broken && broken.length === 0 && (
            <EmptyState
              tone="success"
              icon={<ShieldCheck />}
              title={tp('noBrokenTitle')}
              action={
                <Button variant="secondary" onClick={findBroken} working={busy}>
                  <FileSearch /> {tp('noBrokenAction')}
                </Button>
              }
            >
              {tp('noBrokenBody')}
            </EmptyState>
          )}

          {broken && broken.length > 0 && (
            <>
              <StatTile
                label={tp('brokenCount')}
                value={broken.length.toLocaleString(locale)}
                tone="warning"
              />
              <div className="max-h-48 overflow-auto rounded-card border border-line-subtle bg-surface-3 p-2">
                {broken.slice(0, 200).map((b) => (
                  <div
                    key={b.trackId}
                    style={{ fontSize: 'var(--row-font)' }}
                    className="truncate py-0.5 text-ink-mid"
                  >
                    <span className="text-ink-hi">
                      {b.artist ?? '?'} — {b.title ?? '?'}
                    </span>{' '}
                    <span className="font-mono text-ink-lo">({b.oldPath})</span>
                  </div>
                ))}
                {broken.length > 200 && (
                  <div className="pt-1 text-caption text-ink-lo">
                    {tp('moreN', { n: broken.length - 200 })}
                  </div>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {broken && broken.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-body font-semibold">{tp('step2')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <PathField
              label={tp('fNewRoot')}
              value={newRoot}
              onBrowse={async () => {
                const d = await window.crateforge.dialog.openDirectory();
                if (d) setNewRoot(d);
              }}
            />
            <Button variant="secondary" onClick={doDryRun} disabled={!newRoot} working={busy}>
              {tp('dryBtn')}
            </Button>

            {dryRun && (
              <>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <StatTile label={tp('sBroken')} value={dryRun.broken.toLocaleString(locale)} />
                  <StatTile
                    label={tp('sMatched')}
                    value={dryRun.matched.toLocaleString(locale)}
                    tone="success"
                  />
                  <StatTile
                    label={tp('sAmbiguous')}
                    value={dryRun.ambiguous.toLocaleString(locale)}
                    tone="warning"
                  />
                  <StatTile
                    label={tp('sMissing')}
                    value={(dryRun.broken - dryRun.matched).toLocaleString(locale)}
                  />
                </div>
                <SaveTargetNotice target="xml" />
                {dryRun.matched > 0 && (
                  <Button variant="primary" size="lg" onClick={doWrite} working={busy}>
                    <MapPin /> {tp('writeBtn')}
                  </Button>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}

      {outcome && (
        <Notice
          variant="success"
          title={tp('outTitle')}
          actions={
            <Button size="sm" variant="secondary" onClick={() => setGuideOpen(true)}>
              <BookOpen /> {pageText(locale, 'guide', 'openImport')}
            </Button>
          }
        >
          <p>{outcome.text}</p>
        </Notice>
      )}
      {error && <Notice variant="destructive">{error}</Notice>}

      <GuideDialog kind="importXml" open={guideOpen} onOpenChange={setGuideOpen} />
    </div>
  );
}

/**
 * Ritrova per impronta acustica: confronta le impronte già calcolate con i file
 * presenti nella nuova cartella, quindi funziona anche sui file rinominati.
 */
function ByFingerprintTab() {
  const { locale } = useAppState();
  const tp = (k: string, p?: Record<string, string | number>) =>
    pageText(locale, 'relocator', k, p);
  const { run } = useJobs();
  const [newRoot, setNewRoot] = useState('');
  const [summary, setSummary] = useState<{ broken: number; matched: number; scanned: number } | null>(
    null
  );
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);

  const doMatch = async () => {
    setError(null);
    setSummary(null);
    setBusy(true);
    try {
      const r = await run(tp('fpBtn'), () => window.crateforge.relocatorFp.match(newRoot));
      if (!r.ok) setError(r.message);
      else setSummary(r as { broken: number; matched: number; scanned: number });
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const doWrite = async () => {
    const outPath = await window.crateforge.dialog.saveFile('crateforge-relocation-fp.xml', [
      { name: 'Rekordbox XML', extensions: ['xml'] }
    ]);
    if (!outPath) return;
    setBusy(true);
    try {
      const r = await run(tp('writeBtn'), () => window.crateforge.relocatorFp.writeXml(outPath));
      setOutcome(tp('outFpDone', { n: r.written, path: outPath }));
      setSummary(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <RekordboxDiff
        page="relocatorFp"
        stats={
          summary
            ? [
                { value: summary.matched.toLocaleString(locale), label: tp('sMatched') },
                { value: summary.scanned.toLocaleString(locale), label: tp('sScanned') },
                {
                  value: (summary.broken - summary.matched).toLocaleString(locale),
                  label: tp('sUnresolved'),
                  tone: 'warning' as const
                }
              ]
            : undefined
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-body font-semibold">
            <Fingerprint className="size-4" /> {tp('fpTitle')}
          </CardTitle>
          <CardDescription>{tp('fpDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <PathField
            label={tp('fNewRoot')}
            value={newRoot}
            onBrowse={async () => {
              const d = await window.crateforge.dialog.openDirectory();
              if (d) setNewRoot(d);
            }}
          />
          <Button variant="secondary" onClick={doMatch} disabled={!newRoot} working={busy}>
            <Fingerprint /> {tp('fpBtn')}
          </Button>

          {summary && (
            <>
              <Eyebrow>{tp('fpResult')}</Eyebrow>
              <p className="text-caption text-ink-mid">
                {tp('fpLine', {
                  scanned: summary.scanned,
                  broken: summary.broken,
                  matched: summary.matched
                })}
              </p>
              <SaveTargetNotice target="xml" />
              {summary.matched > 0 && (
                <Button variant="primary" size="lg" onClick={doWrite} working={busy}>
                  <MapPin /> {tp('writeBtn')}
                </Button>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {outcome && (
        <Notice
          variant="success"
          title={tp('outTitle')}
          actions={
            <Button size="sm" variant="secondary" onClick={() => setGuideOpen(true)}>
              <BookOpen /> {pageText(locale, 'guide', 'openImport')}
            </Button>
          }
        >
          {outcome}
        </Notice>
      )}
      {error && <Notice variant="destructive">{error}</Notice>}

      <GuideDialog kind="importXml" open={guideOpen} onOpenChange={setGuideOpen} />
    </div>
  );
}
