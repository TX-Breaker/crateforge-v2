import { useCallback, useEffect, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  FolderOpen,
  Monitor,
  Moon,
  RefreshCw,
  Search,
  ShieldCheck,
  Sun
} from 'lucide-react';
import { Card, CardContent, Eyebrow, StatTile } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge, Checkbox, Notice, Segmented, Switch } from '@/components/ui/misc';
import { HealthRing } from '@/components/data/Charts';
import { useAppState, type Theme, type ThemeStyle } from '@/lib/appState';
import { useLibrary } from '@/lib/library';
import { useJobs } from '@/lib/jobs';
import { LOCALES } from '@/lib/i18n';
import { pageText } from '@/lib/i18nPages';
import { CrateTile } from '@/components/Brand';
import { cn, formatClock, shortenPath } from '@/lib/utils';

type SoftwareId = 'rekordbox' | 'traktor' | 'virtualdj' | 'serato' | 'engine';

interface Detection {
  id: SoftwareId;
  found: boolean;
  path: string | null;
  companionPath?: string | null;
  checked: string[];
  modifiedAt: string | null;
  limit?: 'readOnly' | 'external' | 'directWrite';
  kind: 'masterdb' | 'nml' | 'vdjxml' | 'seratoDir' | 'enginedb';
}

const NAMES: Record<SoftwareId, string> = {
  rekordbox: 'Rekordbox',
  traktor: 'Traktor',
  virtualdj: 'VirtualDJ',
  serato: 'Serato',
  engine: 'Engine DJ'
};

/**
 * Primo avvio (§6.1). Cinque passi: benvenuto, rilevamento, import, diagnosi,
 * preferenze.
 *
 * Il rilevamento copre TUTTI i software supportati, non solo Rekordbox, e
 * mostra soltanto percorsi verificati su disco dal main. Una card "non trovato"
 * è una risposta onesta: CrateForge non dichiara mai di aver visto qualcosa che
 * non ha visto. Da ogni card si può comunque puntare al file a mano.
 */
export function FirstRun() {
  const { locale, setLocale, theme, setTheme, themeStyle, setThemeStyle, mode, setMode, setOnboarded } =
    useAppState();
  const tp = (k: string, p?: Record<string, string | number>) =>
    pageText(locale, 'onboarding', k, p);
  const { refresh, health, stats } = useLibrary();
  const { run } = useJobs();

  const [step, setStep] = useState(0);
  const [detections, setDetections] = useState<Detection[] | null>(null);
  const [chosen, setChosen] = useState<Set<SoftwareId>>(new Set());
  const [manual, setManual] = useState<Partial<Record<SoftwareId, string>>>({});
  const [busy, setBusy] = useState(false);
  const [importLog, setImportLog] = useState<{ id: SoftwareId; ok: boolean; text: string }[]>([]);

  const detect = useCallback(async () => {
    setBusy(true);
    try {
      const d = (await window.crateforge.detect.djSoftware()) as Detection[];
      setDetections(d);
      setChosen(new Set(d.filter((x) => x.found).map((x) => x.id)));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (step === 1 && detections === null) detect();
  }, [step, detections, detect]);

  const pathFor = (d: Detection) => manual[d.id] ?? d.path;

  const browseFor = async (d: Detection) => {
    const filters: Record<Detection['kind'], { name: string; extensions: string[] }[]> = {
      masterdb: [{ name: 'master.db', extensions: ['db'] }],
      nml: [{ name: 'collection.nml', extensions: ['nml'] }],
      vdjxml: [{ name: 'database.xml', extensions: ['xml'] }],
      enginedb: [{ name: 'Engine Library (m.db)', extensions: ['db'] }],
      seratoDir: []
    };
    const picked =
      d.kind === 'seratoDir'
        ? await window.crateforge.dialog.openDirectory()
        : await window.crateforge.dialog.openFile(filters[d.kind]);
    if (!picked) return;
    setManual((m) => ({ ...m, [d.id]: picked }));
    setChosen((c) => new Set(c).add(d.id));
  };

  const importOne = async (d: Detection): Promise<{ ok: boolean; text: string }> => {
    const path = pathFor(d);
    if (!path) return { ok: false, text: tp('noPath') };
    try {
      if (d.kind === 'masterdb') {
        const r = await run(NAMES[d.id], () => window.crateforge.library.ingestMasterdb(path));
        return r.ok
          ? { ok: true, text: tp('importedDb') }
          : { ok: false, text: r.message ?? tp('importFailed') };
      }
      if (d.kind === 'seratoDir') {
        const r = (await run(NAMES[d.id], () => window.crateforge.library.importSerato(path))) as {
          ok: boolean;
          tracks?: number;
          message?: string;
        };
        return r.ok
          ? { ok: true, text: tp('importedN', { n: r.tracks ?? 0 }) }
          : { ok: false, text: r.message ?? tp('importFailed') };
      }
      const kind = d.kind === 'nml' ? 'traktor' : d.kind === 'vdjxml' ? 'virtualdj' : 'engine';
      const r = await run(NAMES[d.id], () => window.crateforge.library.importForeign(kind, path));
      return r.ok
        ? { ok: true, text: tp('importedN', { n: r.tracks }) }
        : { ok: false, text: r.message ?? tp('importFailed') };
    } catch (err) {
      return { ok: false, text: String(err) };
    }
  };

  const runImport = async () => {
    if (!detections) return;
    setBusy(true);
    setImportLog([]);
    try {
      for (const d of detections) {
        if (!chosen.has(d.id)) continue;
        const r = await importOne(d);
        setImportLog((prev) => [...prev, { id: d.id, ...r }]);
      }
      await refresh();
      setStep(3);
    } finally {
      setBusy(false);
    }
  };

  const steps = [tp('s1'), tp('s2'), tp('s3'), tp('s4'), tp('s5')];

  return (
    <div className="flex h-full flex-col bg-canvas">
      {/* barra dei passi */}
      <header className="flex shrink-0 items-center gap-4 border-b border-line-subtle bg-surface-1 px-6 py-3">
        <CrateTile size={22} radius={5} />
        <div className="flex flex-wrap items-center gap-1.5">
          {steps.map((s, i) => (
            <span
              key={s}
              className={cn(
                'flex items-center gap-1.5 rounded-full px-2.5 py-1 text-caption transition-colors duration-swap',
                i === step
                  ? 'bg-accent/15 text-accent'
                  : i < step
                    ? 'text-ink-mid'
                    : 'text-ink-lo'
              )}
            >
              {i < step ? (
                <Check className="size-3" />
              ) : (
                <span className="font-mono text-[10px] tabular-nums">{i + 1}</span>
              )}
              {s}
            </span>
          ))}
        </div>
        <Button
          className="ml-auto"
          size="sm"
          variant="ghost"
          onClick={() => setOnboarded(true)}
        >
          {tp('skip')}
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl space-y-4 p-6">
          {/* 1 — benvenuto */}
          {step === 0 && (
            <div className="space-y-4">
              <div>
                <Eyebrow>{tp('welcomeEyebrow')}</Eyebrow>
                <h2 className="mt-1 text-display text-ink-hi">{tp('welcomeTitle')}</h2>
                <p className="mt-2 max-w-2xl text-body text-ink-mid">{tp('welcomeBody')}</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                {['promise1', 'promise2', 'promise3'].map((k) => (
                  <Card key={k}>
                    <CardContent className="flex gap-2.5 p-4">
                      <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" />
                      <p className="text-caption text-ink-mid">{tp(k)}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>
              <Notice variant="info" title={tp('notTitle')}>
                {tp('notBody')}
              </Notice>
            </div>
          )}

          {/* 2 — rilevamento */}
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <Eyebrow>{tp('detectEyebrow')}</Eyebrow>
                <h2 className="mt-1 text-title text-ink-hi">{tp('detectTitle')}</h2>
                <p className="mt-1 max-w-2xl text-caption text-ink-mid">{tp('detectBody')}</p>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                {(detections ?? []).map((d) => {
                  const path = pathFor(d);
                  const found = d.found || !!manual[d.id];
                  return (
                    <Card
                      key={d.id}
                      className={cn(!found && 'border-dashed bg-transparent shadow-none')}
                    >
                      <CardContent className="space-y-2 p-4">
                        <div className="flex items-center gap-2">
                          <span className="text-section text-ink-hi">{NAMES[d.id]}</span>
                          {found ? (
                            d.limit === 'readOnly' || d.limit === 'directWrite' ? (
                              <Badge variant="warning">
                                {d.limit === 'directWrite' ? tp('directWrite') : tp('readOnly')}
                              </Badge>
                            ) : (
                              <Badge variant="success">{tp('ready')}</Badge>
                            )
                          ) : (
                            <Badge variant="neutral">{tp('notFound')}</Badge>
                          )}
                          {found && (
                            <Checkbox
                              className="ml-auto"
                              checked={chosen.has(d.id)}
                              onCheckedChange={() =>
                                setChosen((prev) => {
                                  const next = new Set(prev);
                                  next.has(d.id) ? next.delete(d.id) : next.add(d.id);
                                  return next;
                                })
                              }
                            />
                          )}
                        </div>

                        {found && path ? (
                          <>
                            <p
                              className="truncate font-mono text-caption text-ink-lo"
                              title={path}
                              data-selectable
                            >
                              {shortenPath(path, 52)}
                            </p>
                            {d.companionPath && (
                              <p className="truncate font-mono text-caption text-ink-lo">
                                {shortenPath(d.companionPath, 52)}
                              </p>
                            )}
                            {d.modifiedAt && (
                              <p className="text-caption text-ink-lo">
                                {tp('modified', { when: formatClock(d.modifiedAt) })}
                              </p>
                            )}
                            {(d.limit === 'readOnly' || d.limit === 'directWrite') && (
                              <p className="text-caption text-warning">{tp('seratoLimit')}</p>
                            )}
                          </>
                        ) : (
                          <>
                            <p className="text-caption text-ink-mid">
                              {d.limit === 'external' ? tp('externalHint') : tp('notFoundHint')}
                            </p>
                            <Button size="sm" variant="secondary" onClick={() => browseFor(d)}>
                              <FolderOpen /> {tp('browse')}
                            </Button>
                          </>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <Button variant="secondary" onClick={detect} working={busy}>
                  <RefreshCw /> {tp('rescan')}
                </Button>
                <span className="text-caption text-ink-lo">
                  {tp('selectedCount', { n: chosen.size })}
                </span>
              </div>

              <Notice variant="info" title={tp('howDetectTitle')}>
                {tp('howDetectBody')}
              </Notice>
            </div>
          )}

          {/* 3 — import */}
          {step === 2 && (
            <div className="space-y-4">
              <div>
                <Eyebrow>{tp('importEyebrow')}</Eyebrow>
                <h2 className="mt-1 text-title text-ink-hi">{tp('importTitle')}</h2>
                <p className="mt-1 max-w-2xl text-caption text-ink-mid">{tp('importBody')}</p>
              </div>

              <div className="space-y-2">
                {(detections ?? [])
                  .filter((d) => chosen.has(d.id))
                  .map((d) => {
                    const done = importLog.find((l) => l.id === d.id);
                    return (
                      <div
                        key={d.id}
                        className="flex items-center gap-3 rounded-card border border-line-subtle bg-surface-2 px-3.5 py-2.5"
                      >
                        <span className="text-body text-ink-hi">{NAMES[d.id]}</span>
                        <span className="min-w-0 flex-1 truncate font-mono text-caption text-ink-lo">
                          {shortenPath(pathFor(d) ?? '', 48)}
                        </span>
                        {done ? (
                          <Badge variant={done.ok ? 'success' : 'destructive'}>{done.text}</Badge>
                        ) : (
                          <Badge variant="neutral">{tp('queued')}</Badge>
                        )}
                      </div>
                    );
                  })}
                {chosen.size === 0 && (
                  <Notice variant="warning">{tp('nothingSelected')}</Notice>
                )}
              </div>

              <Button
                variant="primary"
                size="lg"
                onClick={runImport}
                disabled={chosen.size === 0}
                working={busy}
              >
                <Search /> {tp('runImport')}
              </Button>
            </div>
          )}

          {/* 4 — diagnosi */}
          {step === 3 && (
            <div className="space-y-4">
              <div>
                <Eyebrow>{tp('diagEyebrow')}</Eyebrow>
                <h2 className="mt-1 text-title text-ink-hi">{tp('diagTitle')}</h2>
              </div>
              <Card>
                <CardContent className="flex flex-wrap items-center gap-6 p-5">
                  <HealthRing score={health?.score ?? 0} label={tp('outOf')} />
                  <div className="min-w-[200px] flex-1 space-y-1">
                    <div className="text-section text-ink-hi">
                      {(health?.score ?? 0) >= 85
                        ? tp('scoreGood')
                        : (health?.score ?? 0) >= 60
                          ? tp('scoreMid')
                          : tp('scoreBad')}
                    </div>
                    <p className="text-caption text-ink-mid">{tp('diagBody')}</p>
                  </div>
                </CardContent>
              </Card>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <StatTile label={tp('statTracks')} value={(stats?.tracks ?? 0).toLocaleString(locale)} />
                <StatTile
                  label={tp('statPlaylists')}
                  value={(stats?.playlists ?? 0).toLocaleString(locale)}
                />
                <StatTile
                  label={tp('statReview')}
                  tone={(stats?.needsReview ?? 0) > 0 ? 'warning' : 'neutral'}
                  value={(stats?.needsReview ?? 0).toLocaleString(locale)}
                />
                <StatTile
                  label={tp('statNoCue')}
                  value={(health?.withoutHotCues ?? 0).toLocaleString(locale)}
                />
              </div>
            </div>
          )}

          {/* 5 — preferenze */}
          {step === 4 && (
            <div className="space-y-4">
              <div>
                <Eyebrow>{tp('prefEyebrow')}</Eyebrow>
                <h2 className="mt-1 text-title text-ink-hi">{tp('prefTitle')}</h2>
              </div>

              <Card>
                <CardContent className="space-y-4 p-5">
                  <div className="space-y-2">
                    <Eyebrow>{tp('styleLabel')}</Eyebrow>
                    <Segmented<ThemeStyle>
                      value={themeStyle}
                      onChange={setThemeStyle}
                      options={[
                        { value: 'studio', label: tp('styleStudio') },
                        { value: 'neutral', label: tp('styleNeutral') },
                        { value: 'oled', label: tp('styleOled') }
                      ]}
                    />
                  </div>
                  <div className="space-y-2">
                    <Eyebrow>{tp('brightnessLabel')}</Eyebrow>
                    <Segmented<Theme>
                      value={theme}
                      onChange={setTheme}
                      options={[
                        { value: 'light', label: tp('themeLight'), icon: <Sun /> },
                        { value: 'dark', label: tp('themeDark'), icon: <Moon /> },
                        { value: 'system', label: tp('themeAuto'), icon: <Monitor /> }
                      ]}
                    />
                  </div>
                  <div className="space-y-2">
                    <Eyebrow>{tp('langLabel')}</Eyebrow>
                    <Segmented
                      value={locale}
                      onChange={setLocale}
                      options={LOCALES.map((l) => ({ value: l.id, label: l.label }))}
                    />
                  </div>
                  <label className="flex items-center justify-between gap-4 border-t border-line-subtle pt-3">
                    <span>
                      <span className="block text-body text-ink-hi">{tp('expertLabel')}</span>
                      <span className="block text-caption text-ink-lo">{tp('expertDesc')}</span>
                    </span>
                    <Switch
                      checked={mode === 'expert'}
                      onCheckedChange={(v) => setMode(v ? 'expert' : 'simple')}
                    />
                  </label>
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      </div>

      <footer className="flex shrink-0 items-center gap-2 border-t border-line-subtle bg-surface-1 px-6 py-3">
        <Button
          variant="ghost"
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          disabled={step === 0}
        >
          <ArrowLeft /> {tp('back')}
        </Button>
        <div className="ml-auto">
          {step < 4 ? (
            <Button
              variant="primary"
              onClick={() => setStep((s) => s + 1)}
              disabled={step === 2 && importLog.length === 0}
            >
              {tp('next')} <ArrowRight />
            </Button>
          ) : (
            <Button variant="primary" size="lg" onClick={() => setOnboarded(true)}>
              <Check /> {tp('finish')}
            </Button>
          )}
        </div>
      </footer>
    </div>
  );
}
