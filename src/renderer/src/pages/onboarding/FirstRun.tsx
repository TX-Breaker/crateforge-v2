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
import type { DjSoftware } from '@core/djVersions';
import type { DjSoftwareDetection } from '@core/djDetection';
import {
  AppGridStep,
  DEFAULT_IMPORT_CHOICES,
  FeaturesStep,
  GoalStep,
  ImportPanelStep,
  type ImportChoices,
  type WizardGoal
} from './WizardSteps';

/* Tipi dal core, non copie locali: vedi `core/djDetection` per che cosa è
   successo quando ognuno aveva la sua versione. */
type SoftwareId = DjSoftware;
type Detection = DjSoftwareDetection;

const NAMES: Record<SoftwareId, string> = {
  rekordbox: 'Rekordbox',
  traktor: 'Traktor',
  virtualdj: 'VirtualDJ',
  serato: 'Serato',
  serato4: 'Serato DJ Pro 4',
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

  /* ⚠ La ramificazione. `convert` salta la vetrina delle funzioni e la
     diagnosi: chi sta migrando una volta sola non ha motivo di vederle, e
     mostrargliele comunque trasformerebbe una procedura in una brochure. */
  const [goal, setGoalState] = useState<WizardGoal | null>(null);

  /* La scelta d'obiettivo vive nel UDM, accanto allo stato di completamento:
     la procedura è rieseguibile dalle impostazioni, e chi la riapre deve
     ritrovarsi dove si era collocato invece di ridichiararlo. */
  useEffect(() => {
    let vivo = true;
    void window.crateforge.settings.get('wizardGoal').then((v) => {
      if (vivo && (v === 'convert' || v === 'organize')) setGoalState(v);
    });
    return () => {
      vivo = false;
    };
  }, []);

  const setGoal = (g: WizardGoal) => {
    setGoalState(g);
    void window.crateforge.settings.set('wizardGoal', g);
  };
  const [appIds, setAppIds] = useState<string[]>([]);
  const [choices, setChoices] = useState<ImportChoices>(DEFAULT_IMPORT_CHOICES);

  /**
   * I passi effettivamente mostrati, in ordine, con la loro etichetta.
   * È l'unica fonte: i pallini in testa, la disabilitazione di «Avanti» e il
   * rendering leggono tutti da qui, così non possono divergere.
   */
  /* Chi non sta solo convertendo userà CrateForge nel tempo, quindi ha senso
     mostrargli che cosa sa fare e in che stato è la libreria appena importata.
     Chi sta migrando una volta sola no: per lui sono due schermate di troppo
     fra sé e il risultato. */
  const restera = goal === 'organize' || goal === 'hub' || goal === 'primary';

  const flow: { id: string; labelKey: string }[] = [
    { id: 'welcome', labelKey: 's1' },
    ...(restera ? [{ id: 'features', labelKey: 's6' }] : []),
    { id: 'app', labelKey: 's7' },
    { id: 'importPanel', labelKey: 's8' },
    { id: 'detect', labelKey: 's2' },
    { id: 'import', labelKey: 's3' },
    ...(restera ? [{ id: 'health', labelKey: 's4' }] : []),
    { id: 'prefs', labelKey: 's5' }
  ];

  const [step, setStep] = useState(0);
  const current = flow[Math.min(step, flow.length - 1)].id;
  /**
   * Va a un passo per nome.
   *
   * ⚠ Un passo inesistente NON riporta all'inizio. La versione precedente
   * faceva `Math.max(0, findIndex(...))`: quando l'id non c'era, `findIndex`
   * dava -1 e diventava 0, cioè la schermata di benvenuto. È il difetto per cui
   * il wizard non si chiudeva mai: dopo l'import si chiamava `goTo('health')`,
   * ma il passo salute esiste solo per chi ha scelto di rimettere in ordine la
   * libreria — chi stava solo convertendo tornava al punto di partenza, e da lì
   * ricominciava all'infinito.
   *
   * Ora un id sconosciuto fa avanzare di uno, che è sempre la lettura corretta
   * di «vai avanti», e non torna mai indietro da solo.
   */
  const goTo = (id: string) => {
    const i = flow.findIndex((f) => f.id === id);
    setStep((s) => (i >= 0 ? i : Math.min(s + 1, flow.length - 1)));
  };
  const [detections, setDetections] = useState<Detection[] | null>(null);
  const [chosen, setChosen] = useState<Set<SoftwareId>>(new Set());
  const [manual, setManual] = useState<Partial<Record<SoftwareId, string>>>({});
  const [busy, setBusy] = useState(false);
  const [importLog, setImportLog] = useState<{ id: SoftwareId; ok: boolean; text: string }[]>([]);
  /** nome del file scelto a mano quando non è quello atteso, per software */
  const [wrongPick, setWrongPick] = useState<Partial<Record<SoftwareId, string>>>({});
  /** true quando l'utente ha deciso di proseguire NONOSTANTE un import fallito */
  const [acceptedFailures, setAcceptedFailures] = useState(false);

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
    if (current === 'detect' && detections === null) detect();
  }, [current, detections, detect]);

  const pathFor = (d: Detection) => manual[d.id] ?? d.path;

  const browseFor = async (d: Detection) => {
    const filters: Record<Detection['kind'], { name: string; extensions: string[] }[]> = {
      masterdb: [{ name: 'master.db', extensions: ['db'] }],
      nml: [{ name: 'collection.nml', extensions: ['nml'] }],
      vdjxml: [{ name: 'database.xml', extensions: ['xml'] }],
      enginedb: [{ name: 'Engine Library (m.db)', extensions: ['db'] }],
      serato4db: [{ name: 'Serato DJ Pro 4 (master.sqlite)', extensions: ['sqlite'] }],
      seratoDir: []
    };
    const picked =
      d.kind === 'seratoDir'
        ? await window.crateforge.dialog.openDirectory()
        : // Si apre GIÀ nella cartella giusta: il filtro per estensione non
          // basta a guidare, e nella cartella di VirtualDJ l'unico .xml è
          // `settings.xml`, che è il file sbagliato.
          await window.crateforge.dialog.openFile(filters[d.kind], d.hint.typicalPath);
    if (!picked) return;
    /* Controllo del nome PRIMA di accettarlo. Non è una validazione del
       contenuto — quella la fa il lettore — ma intercetta l'errore più comune
       e lo spiega subito, invece di lasciarlo esplodere tre passi dopo con un
       messaggio che parla di tag XML. */
    const expected = d.hint.fileName;
    const base = picked.split(/[\\/]/).pop() ?? '';
    if (expected && base.toLowerCase() !== expected.toLowerCase()) {
      setWrongPick((w) => ({ ...w, [d.id]: base }));
      return;
    }
    setWrongPick((w) => ({ ...w, [d.id]: undefined }));
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
      if (d.kind === 'serato4db') {
        /* Serato 4 ha un lettore suo: è un database a grafo, non una tabella di
           tracce. Prima finiva nel ramo generico qui sotto. */
        const r = await run(NAMES[d.id], () =>
          window.crateforge.library.importSerato4(path)
        );
        return r.ok
          ? { ok: true, text: tp('importedN', { n: r.tracks ?? 0 }) }
          : { ok: false, text: r.message ?? tp('importFailed') };
      }

      /* ⚠ Mappa ESPLICITA, non una catena di ternari con un ripiego in fondo.
         La versione precedente finiva con `: 'engine'`, quindi qualunque tipo
         non previsto veniva mandato al lettore di Engine e falliva con un
         messaggio che parlava di un altro software. Con una mappa, un tipo
         nuovo dà `undefined` e si ferma dicendo la verità: non so leggerlo. */
      const VERSO: Partial<Record<Detection['kind'], 'traktor' | 'virtualdj' | 'engine'>> = {
        nml: 'traktor',
        vdjxml: 'virtualdj',
        enginedb: 'engine'
      };
      const kind = VERSO[d.kind];
      if (!kind) {
        return { ok: false, text: tp('unknownKind', { kind: d.kind }) };
      }
      const r = await run(NAMES[d.id], () => window.crateforge.library.importForeign(kind, path));
      return r.ok
        ? { ok: true, text: tp('importedN', { n: r.tracks }) }
        : { ok: false, text: r.message ?? tp('importFailed') };
    } catch (err) {
      return { ok: false, text: String(err) };
    }
  };

  /**
   * Import dei software scelti.
   *
   * Se qualcosa fallisce il wizard SI FERMA qui. Prima avanzava comunque alla
   * diagnosi: l'utente vedeva un errore scorrere via e si ritrovava a leggere
   * la salute di una libreria che non era stata importata. Un passo che va
   * avanti dopo un errore sta dicendo che l'errore non conta.
   *
   * Le tre uscite (riprova, cambia file, prosegui lo stesso) stanno nella
   * schermata: la scelta è dell'utente, ma va fatta esplicitamente.
   */
  const runImport = async () => {
    if (!detections) return;
    setBusy(true);
    setImportLog([]);
    setAcceptedFailures(false);
    const results: { id: SoftwareId; ok: boolean; text: string }[] = [];
    try {
      for (const d of detections) {
        if (!chosen.has(d.id)) continue;
        const r = await importOne(d);
        results.push({ id: d.id, ...r });
        setImportLog([...results]);
      }
      await refresh();
      if (results.length > 0 && results.every((r) => r.ok)) setStep((n) => n + 1);
    } finally {
      setBusy(false);
    }
  };

  const failed = importLog.filter((r) => !r.ok);
  const importDone = importLog.length > 0 && !busy;

  const steps = flow.map((f) => tp(f.labelKey));

  return (
    <div className="flex h-full flex-col bg-canvas">
      {/* barra dei passi */}
      {/* ⚠ `pr-window-controls`: su Windows i comandi di finestra sono disegnati
          dal sistema sopra la pagina, e senza quello spazio il pulsante a filo
          destro finisce sotto di loro e non si può più premere. */}
      <header className="flex shrink-0 items-center gap-4 border-b border-line-subtle bg-surface-1 px-6 py-3 pr-window-controls">
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
          {current === 'welcome' && (
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

              {/* ⚠ La domanda che ramifica tutto il resto sta qui, non su un
                  passo suo: la schermata aveva spazio, e un passo in meno è un
                  passo in meno da attraversare per chi vuole solo convertire. */}
              <GoalStep t={tp} value={goal} onChange={setGoal} />
            </div>
          )}

          {current === 'features' && <FeaturesStep t={tp} />}

          {current === 'app' && <AppGridStep t={tp} value={appIds} onChange={setAppIds} />}

          {current === 'importPanel' && (
            <ImportPanelStep t={tp} appIds={appIds} choices={choices} onChange={setChoices} />
          )}

          {/* 2 — rilevamento */}
          {current === 'detect' && (
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
                          ) : d.app.installed ? (
                            /* Installato ma senza libreria: è uno stato
                               diverso da "non installato", e porta l'utente a
                               fare una cosa diversa. */
                            <Badge variant="warning">{tp('noLibraryYet')}</Badge>
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
                              {d.app.installed
                                ? tp('installedNoLibrary', {
                                    app: NAMES[d.id],
                                    v: d.app.version ?? '—'
                                  })
                                : d.limit === 'external'
                                  ? tp('externalHint')
                                  : tp('notFoundHint')}
                            </p>
                            {/* Che cosa deve cercare, per nome e per posto.
                                Senza questo la selezione manuale è indovinare:
                                nella cartella di VirtualDJ ci sono più .xml e
                                uno solo è il database. */}
                            <p className="text-caption text-ink-lo">
                              {d.hint.fileName
                                ? tp('lookFor', { file: d.hint.fileName })
                                : tp('lookForFolder')}
                            </p>
                            <p
                              className="truncate font-mono text-caption text-ink-lo"
                              title={d.hint.typicalPath}
                              data-selectable
                            >
                              {shortenPath(d.hint.typicalPath, 52)}
                            </p>
                            {wrongPick[d.id] && (
                              <p className="text-caption text-destructive">
                                {tp('wrongFile', {
                                  picked: wrongPick[d.id]!,
                                  expected: d.hint.fileName ?? '—'
                                })}
                              </p>
                            )}
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
          {current === 'import' && (
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

              {/* Il wizard si è FERMATO qui perché qualcosa non è entrato.
                  Dice quale, con l'errore vero, e mette in fila le tre uscite:
                  riprovare, tornare a scegliere un altro file, oppure andare
                  avanti sapendo che quella libreria non c'è. */}
              {importDone && failed.length > 0 && (
                <Notice
                  variant="destructive"
                  title={tp('importStoppedTitle', { n: failed.length })}
                  actions={
                    <>
                      <Button size="sm" variant="secondary" onClick={runImport}>
                        <RefreshCw /> {tp('retryImport')}
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => goTo('detect')}>
                        <FolderOpen /> {tp('backToPick')}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          /* Avanza di uno invece di saltare a un passo per nome:
                             quale sia il passo successivo dipende dall'obiettivo
                             scelto, e questo pulsante non deve saperlo. */
                          setAcceptedFailures(true);
                          setStep((s) => Math.min(s + 1, flow.length - 1));
                        }}
                      >
                        {tp('continueAnyway')}
                      </Button>
                    </>
                  }
                >
                  <span className="space-y-1">
                    {failed.map((f) => (
                      <span key={f.id} className="block">
                        <span className="text-ink-hi">{NAMES[f.id]}</span> — {f.text}
                      </span>
                    ))}
                  </span>
                </Notice>
              )}
            </div>
          )}

          {/* 4 — diagnosi */}
          {current === 'health' && (
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
          {current === 'prefs' && (
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
          {step < flow.length - 1 ? (
            <Button
              variant="primary"
              onClick={() => setStep((s) => s + 1)}
              /* Tre cancelli, ognuno per una ragione diversa:
                 - dal benvenuto non si esce senza aver scelto l'obiettivo, che
                   è la scelta da cui dipendono i passi successivi;
                 - dalla griglia neppure, altrimenti il pannello di import non
                   saprebbe cosa proporre;
                 - dal passo import non si esce con un errore aperto: o si
                   risolve, o lo si accetta esplicitamente dal riquadro rosso.
                   Il tasto Avanti non è il posto dove si prendono quelle
                   decisioni. */
              disabled={
                (current === 'welcome' && goal === null) ||
                (current === 'app' && appIds.length === 0) ||
                (current === 'import' &&
                  (importLog.length === 0 || (failed.length > 0 && !acceptedFailures)))
              }
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
