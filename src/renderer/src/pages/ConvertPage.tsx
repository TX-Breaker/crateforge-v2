import { useEffect, useState } from 'react';
import { AlertTriangle, ArrowRightLeft, BookOpen, Download, Waypoints } from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Eyebrow
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Checkbox, Notice, Select } from '@/components/ui/misc';
import { GuideDialog } from '@/components/GuideDialog';
import { SaveTargetNotice } from '@/components/SaveTargetNotice';
import { RekordboxDiff } from '@/components/RekordboxDiff';
import { DangerConfirmDialog } from '@/components/DangerConfirmDialog';
import { useAppState } from '@/lib/appState';
import { useJobs } from '@/lib/jobs';
import { useLibrary } from '@/lib/library';
import {
  SOFTWARE,
  SOFTWARE_LABEL,
  SOURCES_OF,
  useWorkspace,
  type SoftwareId
} from '@/lib/workspace';
import { useNotifications } from '@/lib/notifications';
import { pageText } from '@/lib/i18nPages';
import { t } from '@/lib/i18n';
import { LibrarySyncPanel } from '@/components/LibrarySyncPanel';
import { cn } from '@/lib/utils';

type Format = 'rekordbox' | 'traktor' | 'virtualdj';

/* Sincronizzazione dei punti fra librerie: la regola vive in core/sync.ts, qui
   servono solo i due tipi che attraversano l'IPC. Le destinazioni sono quelle
   che hanno un writer collegato — Serato scrive dentro i file audio e ha la sua
   scheda, con la sua conferma. */
type SyncMode = 'fill' | 'overwrite';
interface SyncPlan {
  tracks: number;
  filled: number;
  replaced: number;
  demoted: number;
  lost: number;
  destroys: boolean;
}
const SYNC_DESTS: SoftwareId[] = ['rekordbox', 'traktor', 'virtualdj', 'engine'];

const FORMATS: { id: Format; title: string; descKey: string; ext: string; defaultName: string }[] = [
  {
    id: 'rekordbox',
    title: 'Rekordbox XML',
    descKey: 'fmtRekordbox',
    ext: 'xml',
    defaultName: 'crateforge-rekordbox.xml'
  },
  {
    id: 'traktor',
    title: 'Traktor NML',
    descKey: 'fmtTraktor',
    ext: 'nml',
    defaultName: 'crateforge-traktor.nml'
  },
  {
    id: 'virtualdj',
    title: 'VirtualDJ XML',
    descKey: 'fmtVdj',
    ext: 'xml',
    defaultName: 'crateforge-virtualdj.xml'
  }
];

type SourceId =
  | 'rekordbox-db'
  | 'rekordbox-xml'
  | 'traktor'
  | 'virtualdj'
  | 'engine'
  | 'serato'
  | 'serato4'
  | 'djay';

const SOURCES: { id: SourceId; label: string; ext: string; udm: string }[] = [
  { id: 'rekordbox-db', label: 'Rekordbox (master.db)', ext: 'db', udm: 'masterdb' },
  { id: 'rekordbox-xml', label: 'Rekordbox (collection XML)', ext: 'xml', udm: 'xml' },
  { id: 'traktor', label: 'Traktor (.nml)', ext: 'nml', udm: 'traktor' },
  { id: 'virtualdj', label: 'VirtualDJ (database.xml)', ext: 'xml', udm: 'virtualdj' },
  { id: 'engine', label: 'Engine DJ (m.db)', ext: 'db', udm: 'engine' },
  { id: 'serato', label: 'Serato DJ Pro 3 (_Serato_)', ext: '', udm: 'serato' },
  /* ⚠ Serato 4 è un formato DIVERSO dal ≤3, non una sua variante: database
     SQLite invece di una cartella di file binari. Le due librerie possono
     coesistere sulla stessa macchina, quindi restano due voci distinte. */
  { id: 'serato4', label: 'Serato DJ Pro 4 (master.sqlite)', ext: 'sqlite', udm: 'serato' },
  { id: 'djay', label: 'Djay Pro (MediaLibrary.db)', ext: 'db', udm: 'djay' }
];

type Cap = 'full' | 'partial' | 'none';

const MATRIX: { app: string; imp: Cap; impKey: string; exp: Cap; expKey: string }[] = [
  { app: 'Rekordbox', imp: 'full', impKey: 'rbImport', exp: 'full', expKey: 'rbExport' },
  { app: 'Traktor', imp: 'full', impKey: 'trImport', exp: 'full', expKey: 'trExport' },
  { app: 'VirtualDJ', imp: 'partial', impKey: 'vdjImport', exp: 'full', expKey: 'vdjExport' },
  { app: 'Engine DJ', imp: 'full', impKey: 'enImport', exp: 'partial', expKey: 'enExport' },
  { app: 'Serato', imp: 'full', impKey: 'srImport', exp: 'partial', expKey: 'srExport' },
  { app: 'Djay Pro', imp: 'partial', impKey: 'djImport', exp: 'none', expKey: 'djExport' }
];

/**
 * Mappa dei campi per formato di destinazione (§6.5). È un fatto del formato,
 * non un'opinione: `dropped` significa che quel dato NON esiste nel contenitore
 * di arrivo, e nessun software potrebbe portarlo.
 */
const FIELD_MAP: Record<Format, { fieldKey: string; cap: Cap; toKey: string }[]> = {
  rekordbox: [
    { fieldKey: 'fBasic', cap: 'full', toKey: 'fBasicTo' },
    { fieldKey: 'fBpmKey', cap: 'full', toKey: 'fBpmKeyTo' },
    { fieldKey: 'fCues', cap: 'partial', toKey: 'fCuesRb' },
    { fieldKey: 'fGrid', cap: 'partial', toKey: 'fGridRb' },
    { fieldKey: 'fPlaylists', cap: 'full', toKey: 'fPlaylistsTo' },
    { fieldKey: 'fSmart', cap: 'none', toKey: 'fNoEquiv' },
    { fieldKey: 'fMyTag', cap: 'none', toKey: 'fNoEquiv' },
    { fieldKey: 'fLoops', cap: 'partial', toKey: 'fLoopsRb' }
  ],
  traktor: [
    { fieldKey: 'fBasic', cap: 'full', toKey: 'fBasicTr' },
    { fieldKey: 'fBpmKey', cap: 'full', toKey: 'fBpmKeyTr' },
    { fieldKey: 'fCues', cap: 'partial', toKey: 'fCuesTr' },
    { fieldKey: 'fGrid', cap: 'partial', toKey: 'fGridTr' },
    { fieldKey: 'fPlaylists', cap: 'full', toKey: 'fPlaylistsTo' },
    { fieldKey: 'fSmart', cap: 'none', toKey: 'fNoEquiv' },
    { fieldKey: 'fMyTag', cap: 'none', toKey: 'fNoEquiv' },
    { fieldKey: 'fLoops', cap: 'partial', toKey: 'fLoopsTr' }
  ],
  virtualdj: [
    { fieldKey: 'fBasic', cap: 'full', toKey: 'fBasicVdj' },
    { fieldKey: 'fBpmKey', cap: 'full', toKey: 'fBpmKeyVdj' },
    { fieldKey: 'fCues', cap: 'partial', toKey: 'fCuesVdj' },
    { fieldKey: 'fGrid', cap: 'partial', toKey: 'fGridVdj' },
    { fieldKey: 'fPlaylists', cap: 'full', toKey: 'fPlaylistsTo' },
    { fieldKey: 'fSmart', cap: 'none', toKey: 'fNoEquiv' },
    { fieldKey: 'fMyTag', cap: 'none', toKey: 'fNoEquiv' },
    { fieldKey: 'fLoops', cap: 'full', toKey: 'fLoopsVdj' }
  ]
};

const CAP_TONE: Record<Cap, string> = {
  full: 'text-success',
  partial: 'text-warning',
  none: 'text-ink-lo'
};
const CAP_MARK: Record<Cap, string> = { full: '●', partial: '◐', none: '○' };

/**
 * Converti libreria. La conversione è il punto in cui gli utenti si fanno male,
 * quindi la pagina è costruita attorno a ciò che NON sopravviverà: la mappa dei
 * campi è contenuto primario, sopra l'azione, non una nota a piè di pagina.
 */
/**
 * I numeri della sincronizzazione, sempre gli stessi cinque e sempre nello
 * stesso ordine: quanti brani, quanto entra, quanto viene sostituito, quanto
 * scende a memory, quanto si perde. L'ultimo è l'unico che conta davvero, ed è
 * per questo che è marcato anche quando vale zero.
 */
function SyncFacts({
  plan,
  locale,
  tp
}: {
  plan: SyncPlan;
  locale: string;
  tp: (k: string, p?: Record<string, string | number>) => string;
}) {
  const rows: { k: string; v: number; warn?: boolean }[] = [
    { k: 'syncFactTracks', v: plan.tracks },
    { k: 'syncFactFilled', v: plan.filled },
    { k: 'syncFactReplaced', v: plan.replaced },
    { k: 'syncFactDemoted', v: plan.demoted },
    { k: 'syncFactLost', v: plan.lost, warn: plan.lost > 0 }
  ];
  return (
    <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 rounded-md border border-line bg-surface-2 px-3 py-2">
      {rows.map((r) => (
        <div key={r.k} className="col-span-2 grid grid-cols-subgrid">
          <dt className="text-caption text-ink-mid">{tp(r.k)}</dt>
          <dd
            className={cn(
              'text-right font-mono text-caption tabular-nums',
              r.warn ? 'text-warning' : 'text-ink-hi'
            )}
          >
            {r.v.toLocaleString(locale)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function ConvertPage() {
  const { locale } = useAppState();
  const tp = (k: string, p?: Record<string, string | number>) =>
    pageText(locale, 'converter', k, p);
  const { run } = useJobs();
  const { refresh } = useLibrary();
  const { push } = useNotifications();
  const { scope, target } = useWorkspace();

  const [pending, setPending] = useState<Format | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Avvisi del writer: ciò che non è rappresentabile va DETTO, non scartato.
  const [warnings, setWarnings] = useState<string[]>([]);
  /* Conteggio della prova a vuoto: quanti file verrebbero modificati DAVVERO.
     La scrittura sugli originali non parte finché l'utente non ha visto
     questo numero e non ha digitato la parola di conferma. */
  const [seratoPlan, setSeratoPlan] = useState<{
    files: number;
    cues: number;
    loops: number;
  } | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const [srcSel, setSrcSel] = useState<SourceId>('rekordbox-db');
  const [dstSel, setDstSel] = useState<Format>('traktor');
  const [convertSource, setConvertSource] = useState<string | null>(null);

  /* Da quale libreria arrivano i punti. Preselezionata con la libreria della
     sessione: se stai lavorando "da Rekordbox", è da lì che li vuoi. Il modo
     predefinito è quello che non distrugge niente. */
  const [syncOrigin, setSyncOrigin] = useState<SoftwareId | null>(
    scope === 'all' ? null : scope
  );
  const [syncMode, setSyncMode] = useState<SyncMode>('fill');
  const [syncDest, setSyncDest] = useState<SoftwareId>(
    target !== 'ask' && SYNC_DESTS.includes(target) ? target : 'traktor'
  );
  /** conteggio mostrato nella scheda: cambia con origine, modo e destinazione */
  const [syncPreview, setSyncPreview] = useState<SyncPlan | null>(null);
  /** conteggio della destinazione VERA, calcolato prima di aprire la conferma */
  const [pendingPlan, setPendingPlan] = useState<SyncPlan | null>(null);

  /* Export verso tutti i software trovati sul computer. La cartella si sceglie
     una volta sola; i nomi dei file li mette CrateForge, perché sono tre e
     lasciarli scegliere uno per uno era esattamente la fatica da togliere. */
  const [detected, setDetected] = useState<SoftwareId[] | null>(null);
  const [allDir, setAllDir] = useState<string | null>(null);
  const [allPlans, setAllPlans] = useState<{ id: SoftwareId; plan: SyncPlan | null }[]>([]);

  useEffect(() => {
    void window.crateforge.detect
      .djSoftware()
      .then((list) =>
        setDetected(
          (list as { id: string; found: boolean }[])
            .filter((d) => d.found)
            .map((d) => d.id as SoftwareId)
        )
      )
      .catch(() => setDetected([]));
  }, []);

  /** Le destinazioni che il pulsante "verso tutti" tocca davvero. */
  const allTargets = (detected ?? []).filter((d) => d !== 'engine' && d !== 'serato');

  const startExportAll = async () => {
    if (!allTargets.length) return;
    const dir = await window.crateforge.dialog.openDirectory();
    if (!dir) return;
    setError(null);
    setOutcome(null);
    setWarnings([]);
    // I numeri per OGNI destinazione, calcolati prima di aprire la conferma.
    setAllPlans(
      await Promise.all(allTargets.map(async (id) => ({ id, plan: await planFor(id) })))
    );
    setAllDir(dir);
  };

  const doExportAll = async () => {
    const dir = allDir;
    setAllDir(null);
    if (!dir) return;
    setBusy(true);
    try {
      const r = await run(tp('jobExport', { fmt: tp('allBtn') }), () =>
        window.crateforge.exportAll(dir, {
          source: convertSource ?? undefined,
          sync: syncOrigin
            ? { originSources: SOURCES_OF[syncOrigin], mode: syncMode }
            : undefined
        })
      );
      const done = r.results.filter((x) => x.ok);
      const text = tp('allDone', { n: done.length, dir: r.outDir });
      setOutcome(text);
      setWarnings([
        ...r.results
          .filter((x) => !x.ok)
          .map((x) => tp('allFailed', { sw: SOFTWARE_LABEL[x.id as SoftwareId], msg: x.message ?? '' })),
        ...done.flatMap((x) => x.warnings ?? []),
        ...r.skipped.map((x) =>
          x.reason === 'needs-template'
            ? tp('allSkipEngine')
            : x.reason === 'writes-originals'
              ? tp('allSkipSerato')
              : tp('allSkipNotFound', { sw: SOFTWARE_LABEL[x.id as SoftwareId] })
        )
      ]);
      push({ kind: 'success', job: true, title: tp('title'), body: text });
    } catch (err) {
      setError(String(err));
      push({ kind: 'error', job: true, title: tp('title'), body: String(err) });
    } finally {
      setBusy(false);
    }
  };

  /**
   * La selezione da passare a un export. Vale `undefined` — cioè comportamento
   * normale — quando non c'è origine, o quando origine e destinazione sono lo
   * stesso software: sincronizzare una libreria con sé stessa non significa
   * niente, e con due righe dello stesso file finirebbe per fondersi da sola.
   */
  const syncFor = (dest: SoftwareId) =>
    !syncOrigin || syncOrigin === dest
      ? undefined
      : { originSources: SOURCES_OF[syncOrigin], destination: dest, mode: syncMode };

  const planFor = async (dest: SoftwareId): Promise<SyncPlan | null> => {
    const sync = syncFor(dest);
    if (!sync) return null;
    try {
      return await window.crateforge.sync.plan({
        originSources: sync.originSources,
        destinationSources: SOURCES_OF[dest],
        destination: dest,
        mode: syncMode
      });
    } catch {
      /* Il conteggio è un'informazione in più: se non arriva, l'export resta
         possibile e la conferma lo dirà mostrando nulla invece di un numero. */
      return null;
    }
  };

  useEffect(() => {
    let alive = true;
    void planFor(syncDest).then((p) => alive && setSyncPreview(p));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncOrigin, syncMode, syncDest]);

  const startExport = async (fmt: Format) => {
    setConvertSource(null);
    setAcknowledged(false);
    setPendingPlan(await planFor(fmt));
    setPending(fmt);
  };

  const importSource = async (src: SourceId): Promise<boolean> => {
    setError(null);
    setOutcome(null);
    if (src === 'serato') {
      const dir = await window.crateforge.dialog.openDirectory();
      if (!dir) return false;
      setBusy(true);
      try {
        const r = await run(tp('jobImport'), () => window.crateforge.library.importSerato(dir));
        if (!r.ok) {
          setError(r.message ?? tp('convErr'));
          return false;
        }
        await refresh();
        return true;
      } catch (err) {
        setError(String(err));
        return false;
      } finally {
        setBusy(false);
      }
    }

    /* Serato 4 e djay sanno dove sta la propria libreria: si prova la posizione
       di sistema, e solo se non c'è si chiede il file all'utente. */
    if (src === 'serato4' || src === 'djay') {
      setBusy(true);
      try {
        const r =
          src === 'serato4'
            ? await run(tp('jobImport'), () => window.crateforge.library.importSerato4())
            : await run(tp('jobImport'), () => window.crateforge.library.importDjay());
        if (!r.ok) {
          setError(r.message ?? tp('convErr'));
          return false;
        }
        await refresh();
        return true;
      } catch (err) {
        setError(String(err));
        return false;
      } finally {
        setBusy(false);
      }
    }

    const def = SOURCES.find((s) => s.id === src)!;
    let path: string | null;
    if (src === 'rekordbox-db') {
      const rb = await window.crateforge.rekordbox.defaultPaths();
      path = await window.crateforge.dialog.openFile(
        [{ name: def.label, extensions: [def.ext] }],
        rb.masterDbExists ? rb.masterDb : rb.dir
      );
    } else {
      path = await window.crateforge.dialog.openFile([{ name: def.label, extensions: [def.ext] }]);
    }
    if (!path) return false;

    setBusy(true);
    try {
      if (src === 'rekordbox-db') {
        const r = await run(tp('jobImport'), () => window.crateforge.library.ingestMasterdb(path!));
        if (!r.ok) {
          setError(r.message ?? tp('convErr'));
          return false;
        }
      } else if (src === 'rekordbox-xml') {
        await run(tp('jobImport'), () => window.crateforge.library.ingestXml(path!));
      } else {
        const r = await run(tp('jobImport'), () =>
          window.crateforge.library.importForeign(src, path!)
        );
        if (!r.ok) {
          setError(r.message ?? tp('convErr'));
          return false;
        }
        if (r.warnings?.length) setOutcome(r.warnings.join(' '));
      }
      await refresh();
      return true;
    } catch (err) {
      setError(String(err));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const startConvert = async () => {
    const ok = await importSource(srcSel);
    if (!ok) return;
    setConvertSource(SOURCES.find((s) => s.id === srcSel)!.udm);
    setAcknowledged(false);
    setPending(dstSel);
  };

  /**
   * Serato: non c'è un file da salvare, i cue vanno DENTRO i file audio. È
   * quindi una scrittura sugli originali: passa dal gate delle scritture
   * dirette, con backup verificato e rollback automatico nel sidecar.
   */
  /**
   * Passo 1: si chiede al processo principale QUANTI file verrebbero toccati,
   * senza toccarne nessuno. Il numero finisce nella conferma.
   */
  const planExportSeratoCues = async () => {
    setError(null);
    setOutcome(null);
    setWarnings([]);
    setBusy(true);
    try {
      const r = await window.crateforge.exporter.seratoCues({
        ...(convertSource ? { source: convertSource } : {}),
        dryRun: true
      });
      if (!r.ok) {
        setError(r.message ?? tp('convErr'));
        return;
      }
      setSeratoPlan({ files: r.files ?? 0, cues: r.cues ?? 0, loops: r.loops ?? 0 });
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  /** Passo 2: la scrittura vera, solo dopo la conferma digitata. */
  const doExportSeratoCues = async () => {
    setSeratoPlan(null);
    setError(null);
    setOutcome(null);
    setWarnings([]);
    setBusy(true);
    try {
      const sel = convertSource ? { source: convertSource } : undefined;
      /* Non annullabile di proposito: il ripristino promesso all'utente è un
         blocco `except` dentro il sidecar, e un processo terminato a forza non
         lo esegue mai. Meglio niente pulsante che un pulsante che lascia un
         MP3 scritto a metà. */
      const r = await run(
        tp('jobExport', { fmt: 'Serato' }),
        () => window.crateforge.exporter.seratoCues(sel),
        { cancellable: false }
      );
      if (!r.ok) {
        setError(r.message ?? tp('convErr'));
        push({ kind: 'error', job: true, title: tp('title'), body: r.message ?? tp('convErr') });
        return;
      }
      const text = tp('seratoOutDone', {
        n: r.written ?? 0,
        files: r.files ?? 0,
        dir: r.backupDir ?? ''
      });
      setOutcome(text);
      // I file non modificati sono stati ripristinati dal backup: va detto.
      if (r.failed) setWarnings([tp('seratoFailed', { n: r.failed })]);
      push({ kind: 'success', job: true, title: tp('title'), body: text });
    } catch (err) {
      setError(String(err));
      push({ kind: 'error', job: true, title: tp('title'), body: String(err) });
    } finally {
      setBusy(false);
    }
  };

  /**
   * Playlist Serato: file .crate in Subcrates. Il sidecar non sovrascrive mai
   * un crate esistente, perché il formato non ha ancora un round-trip
   * verificato contro un crate scritto da Serato.
   */
  const doExportSeratoCrates = async () => {
    const dir = await window.crateforge.dialog.openDirectory();
    if (!dir) return;
    setError(null);
    setOutcome(null);
    setWarnings([]);
    setBusy(true);
    try {
      const r = await run(tp('jobExport', { fmt: 'Serato' }), () =>
        window.crateforge.exporter.seratoCrates(dir)
      );
      if (!r.ok) {
        setError(r.message ?? tp('convErr'));
        push({ kind: 'error', job: true, title: tp('title'), body: r.message ?? tp('convErr') });
        return;
      }
      const text = tp('seratoCratesDone', { n: r.written ?? 0 });
      setOutcome(text);
      if (r.skipped?.length) {
        setWarnings([
          tp('seratoCratesSkipped', { n: r.skipped.length, list: r.skipped.join(', ') })
        ]);
      }
      push({ kind: 'success', job: true, title: tp('title'), body: text });
    } catch (err) {
      setError(String(err));
      push({ kind: 'error', job: true, title: tp('title'), body: String(err) });
    } finally {
      setBusy(false);
    }
  };

  /**
   * Engine DJ: chiediamo dove creare la libreria NUOVA e un m.db esistente da
   * usare come modello dello schema, così la libreria generata ha la stessa
   * versione dell'installazione dell'utente invece di una nostra ipotesi.
   */
  const doExportEngine = async () => {
    const outDir = await window.crateforge.dialog.openDirectory();
    if (!outDir) return;
    const template = await window.crateforge.dialog.openFile([
      { name: 'Engine DJ (m.db)', extensions: ['db'] }
    ]);
    if (!template) return;
    setError(null);
    setOutcome(null);
    setWarnings([]);
    setBusy(true);
    try {
      const sel = { source: convertSource ?? undefined, sync: syncFor('engine') };
      const r = await run(tp('jobExport', { fmt: 'Engine DJ' }), () =>
        window.crateforge.exporter.engineLibrary(outDir, template, sel as never)
      );
      if (!r.ok) {
        setError(r.message ?? tp('convErr'));
        push({ kind: 'error', job: true, title: tp('title'), body: r.message ?? tp('convErr') });
        return;
      }
      const text = tp('engineOutDone', {
        n: (r.tracks ?? 0).toLocaleString(locale),
        cues: r.cues ?? 0,
        loops: r.loops ?? 0,
        path: r.dbPath ?? ''
      });
      setOutcome(text);
      if (r.warnings?.length) setWarnings(r.warnings);
      push({ kind: 'success', job: true, title: tp('title'), body: text });
    } catch (err) {
      setError(String(err));
      push({ kind: 'error', job: true, title: tp('title'), body: String(err) });
    } finally {
      setBusy(false);
      setConvertSource(null);
    }
  };

  const doExport = async () => {
    if (!pending) return;
    const fmt = FORMATS.find((f) => f.id === pending)!;
    setPending(null);
    const outPath = await window.crateforge.dialog.saveFile(fmt.defaultName, [
      { name: fmt.title, extensions: [fmt.ext] }
    ]);
    if (!outPath) return;
    const sync = syncFor(fmt.id);
    const sel = convertSource || sync ? { source: convertSource ?? undefined, sync } : undefined;
    setError(null);
    setOutcome(null);
    setWarnings([]);
    setBusy(true);
    try {
      const r = await run(tp('jobExport', { fmt: fmt.title }), () =>
        fmt.id === 'rekordbox'
          ? window.crateforge.exporter.rekordboxXml(outPath, sel)
          : fmt.id === 'traktor'
            ? window.crateforge.exporter.traktorNml(outPath, sel)
            : window.crateforge.exporter.virtualdjXml(outPath, sel)
      );
      const text =
        tp('outDone', { fmt: fmt.title, n: r.tracks.toLocaleString(locale), path: outPath }) +
        (fmt.id === 'rekordbox' ? tp('outRbTail') : '');
      setOutcome(text);
      // Quello che il formato di arrivo non sa rappresentare (cue oltre l'ottavo
      // pad, colori verso Traktor, memory cue…) viene detto qui, non nel log.
      if (r.warnings?.length) setWarnings(r.warnings);
      push({ kind: 'success', job: true, title: tp('title'), body: text });
    } catch (err) {
      setError(String(err));
      push({ kind: 'error', job: true, title: tp('title'), body: String(err) });
    } finally {
      setBusy(false);
      setConvertSource(null);
    }
  };

  const dropped = FIELD_MAP[dstSel].filter((f) => f.cap === 'none').length;

  return (
    <div className="space-y-4">
      <RekordboxDiff page="converter" />

      {/* conversione diretta X→Y */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-body font-semibold">
            <ArrowRightLeft className="size-4" /> {tp('directTitle')}
          </CardTitle>
          <CardDescription>{tp('directDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Eyebrow>{tp('srcLabel')}</Eyebrow>
              <Select
                className="min-w-[260px]"
                value={srcSel}
                label={tp('srcLabel')}
                onValueChange={(v) => setSrcSel(v as SourceId)}
                disabled={busy}
                options={SOURCES.map((s) => ({ value: s.id, label: s.label }))}
              />
            </div>
            <span className="pb-2 text-ink-lo">→</span>
            <div className="space-y-1.5">
              <Eyebrow>{tp('dstLabel')}</Eyebrow>
              <Select
                className="min-w-[200px]"
                value={dstSel}
                label={tp('dstLabel')}
                onValueChange={(v) => setDstSel(v as Format)}
                disabled={busy}
                options={FORMATS.map((f) => ({ value: f.id, label: f.title }))}
              />
            </div>
            <Button variant="primary" onClick={startConvert} working={busy}>
              <ArrowRightLeft /> {tp('convertBtn')}
            </Button>
          </div>
          <SaveTargetNotice target="xml" />
        </CardContent>
      </Card>

      {/* Sincronizzazione dei punti fra librerie: chi vince il pad, e che fine
          fa chi perde. Il numero delle perdite si vede PRIMA di scrivere. */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-body font-semibold">
            <Waypoints className="size-4" /> {tp('syncTitle')}
          </CardTitle>
          <CardDescription>{tp('syncDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Eyebrow>{tp('syncOriginLabel')}</Eyebrow>
              <Select
                className="min-w-[260px]"
                value={syncOrigin ?? 'none'}
                label={tp('syncOriginLabel')}
                onValueChange={(v) => setSyncOrigin(v === 'none' ? null : (v as SoftwareId))}
                disabled={busy}
                options={[
                  { value: 'none', label: tp('syncOriginNone') },
                  ...SOFTWARE.map((sw) => ({ value: sw, label: SOFTWARE_LABEL[sw] }))
                ]}
              />
            </div>
            {syncOrigin && (
              <div className="space-y-1.5">
                <Eyebrow>{tp('syncModeLabel')}</Eyebrow>
                <div className="flex gap-1.5">
                  <Button
                    size="sm"
                    variant={syncMode === 'fill' ? 'primary' : 'secondary'}
                    onClick={() => setSyncMode('fill')}
                    disabled={busy}
                  >
                    {tp('syncFill')}
                  </Button>
                  <Button
                    size="sm"
                    variant={syncMode === 'overwrite' ? 'primary' : 'secondary'}
                    onClick={() => setSyncMode('overwrite')}
                    disabled={busy}
                  >
                    {tp('syncOverwrite')}
                  </Button>
                </div>
              </div>
            )}
          </div>
          {syncOrigin && (
            <>
              <p className="text-caption text-ink-lo">
                {syncMode === 'fill' ? tp('syncFillHint') : tp('syncOverwriteHint')}
              </p>
              {/* La destinazione qui serve solo al conteggio: l'export vero
                  ricalcola sul software di arrivo e lo mostra nella conferma. */}
              <div className="flex flex-wrap items-center gap-1.5">
                {SYNC_DESTS.filter((d) => d !== syncOrigin).map((d) => (
                  <Button
                    key={d}
                    size="sm"
                    variant={syncDest === d ? 'primary' : 'ghost'}
                    onClick={() => setSyncDest(d)}
                  >
                    {tp('syncPreviewFor', { fmt: SOFTWARE_LABEL[d] })}
                  </Button>
                ))}
              </div>
              {syncPreview && syncPreview.tracks === 0 && (
                <p className="text-caption text-ink-lo">{tp('syncNothing')}</p>
              )}
              {syncPreview && syncPreview.tracks > 0 && (
                <SyncFacts plan={syncPreview} locale={locale} tp={tp} />
              )}
              {syncPreview && syncPreview.destroys && syncPreview.lost > 0 && (
                <Notice variant="warning" title={tp('syncLossTitle')}>
                  {tp('syncLossBody', {
                    fmt: SOFTWARE_LABEL[syncDest],
                    n: syncPreview.lost.toLocaleString(locale)
                  })}
                </Notice>
              )}
              <p className="text-caption text-ink-lo">{tp('syncSeratoNote')}</p>
            </>
          )}
        </CardContent>
      </Card>

      {/* Sincronizzazione dei METADATI. Sta accanto a quella dei punti, non su
          una pagina sua: chi allinea due librerie e chi ne converte una fanno
          la stessa cosa con un'intenzione diversa, e separarle costringerebbe a
          duplicare selettori, prova a vuoto e pannello dei numeri. */}
      <LibrarySyncPanel
        t={tp}
        libraries={SOFTWARE.map((id) => ({ id, sources: SOURCES_OF[id] }))}
        locale={locale}
      />

      {/* Un colpo solo verso tutto quello che c'è su questo computer. */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-body font-semibold">
            <Download className="size-4" /> {tp('allTitle')}
          </CardTitle>
          <CardDescription>{tp('allDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {detected !== null && allTargets.length === 0 ? (
            <p className="text-caption text-ink-lo">{tp('allNone')}</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="primary" onClick={() => void startExportAll()} disabled={busy}>
                  <Download /> {tp('allBtn')}
                </Button>
                {allTargets.map((id) => (
                  <span
                    key={id}
                    className="rounded-full border border-line px-2 py-0.5 text-caption text-ink-mid"
                  >
                    {SOFTWARE_LABEL[id]}
                  </span>
                ))}
              </div>
              <SaveTargetNotice target="xml" />
            </>
          )}
        </CardContent>
      </Card>

      {/* mappa dei campi: contenuto primario, non nota a piè di pagina */}
      <Card>
        <CardHeader>
          <CardTitle className="text-body font-semibold">
            {tp('fieldMapTitle', { fmt: FORMATS.find((f) => f.id === dstSel)!.title })}
          </CardTitle>
          <CardDescription>{tp('fieldMapDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="overflow-x-auto rounded-card border border-line-subtle">
            <table className="w-full text-left">
              <thead className="border-b border-line-subtle bg-surface-3">
                <tr className="font-mono text-[9.5px] uppercase tracking-[.12em] text-ink-lo">
                  <th className="px-3 py-2">{tp('colSource')}</th>
                  <th className="px-3 py-2">{tp('colStatus')}</th>
                  <th className="px-3 py-2">{tp('colDest')}</th>
                </tr>
              </thead>
              <tbody>
                {FIELD_MAP[dstSel].map((f) => (
                  <tr key={f.fieldKey} className="border-b border-line-subtle last:border-b-0">
                    <td className="px-3 py-1.5 text-caption text-ink-hi">{tp(f.fieldKey)}</td>
                    <td className={cn('px-3 py-1.5 font-mono text-caption', CAP_TONE[f.cap])}>
                      {CAP_MARK[f.cap]} {tp(`cap_${f.cap}`)}
                    </td>
                    <td className="px-3 py-1.5 text-caption text-ink-mid">{tp(f.toKey)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Notice variant="warning" title={tp('droppedTitle', { n: dropped })}>
            {tp('droppedBody')}
          </Notice>
        </CardContent>
      </Card>

      {/* matrice di compatibilità */}
      <Card>
        <CardHeader>
          <CardTitle className="text-body font-semibold">{tp('matrixTitle')}</CardTitle>
          <CardDescription>{tp('matrixDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="overflow-x-auto rounded-card border border-line-subtle">
            <table className="w-full text-left">
              <thead className="border-b border-line-subtle bg-surface-3">
                <tr className="font-mono text-[9.5px] uppercase tracking-[.12em] text-ink-lo">
                  <th className="px-3 py-2">{tp('colSoftware')}</th>
                  <th className="px-3 py-2">{tp('colImport')}</th>
                  <th className="px-3 py-2">{tp('colExport')}</th>
                </tr>
              </thead>
              <tbody>
                {MATRIX.map((r) => (
                  <tr key={r.app} className="border-b border-line-subtle last:border-b-0">
                    <td className="px-3 py-1.5 text-caption font-medium text-ink-hi">{r.app}</td>
                    <td className="px-3 py-1.5 text-caption text-ink-mid">
                      <span className={cn('mr-1.5 font-mono', CAP_TONE[r.imp])}>
                        {CAP_MARK[r.imp]}
                      </span>
                      {tp(r.impKey)}
                    </td>
                    <td className="px-3 py-1.5 text-caption text-ink-mid">
                      <span className={cn('mr-1.5 font-mono', CAP_TONE[r.exp])}>
                        {CAP_MARK[r.exp]}
                      </span>
                      {tp(r.expKey)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="flex flex-wrap gap-3 text-caption text-ink-lo">
            <span>
              <span className="font-mono text-success">●</span> {tp('cellFull')}
            </span>
            <span>
              <span className="font-mono text-warning">◐</span> {tp('cellPartial')}
            </span>
            <span>
              <span className="font-mono">○</span> {tp('cellNone')}
            </span>
          </p>
        </CardContent>
      </Card>

      {/* export singoli */}
      <div className="grid gap-4 lg:grid-cols-3">
        {FORMATS.map((f) => (
          <Card key={f.id}>
            <CardHeader>
              <CardTitle className="text-body font-semibold">{f.title}</CardTitle>
              <CardDescription>{tp(f.descKey)}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <Button variant="secondary" onClick={() => void startExport(f.id)} disabled={busy}>
                <Download /> {tp('exportBtn')}
              </Button>
              {syncFor(f.id) && (
                <p className="flex items-center gap-1.5 text-caption text-accent">
                  <Waypoints className="size-3.5 shrink-0" />
                  {tp('syncBadge', { sw: SOFTWARE_LABEL[syncOrigin as SoftwareId] })}
                </p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Serato: i cue vivono nei file audio, quindi è una scrittura sugli
            originali — gate delle scritture dirette, backup e rollback. */}
        <Card>
          <CardHeader>
            <CardTitle className="text-body font-semibold">{tp('seratoExportTitle')}</CardTitle>
            <CardDescription>{tp('seratoExportDesc')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={planExportSeratoCues} disabled={busy}>
                <Download /> {tp('seratoExportBtn')}
              </Button>
              <Button variant="secondary" onClick={doExportSeratoCrates} disabled={busy}>
                <Download /> {tp('seratoCratesBtn')}
              </Button>
            </div>
            <p className="text-caption text-ink-lo">{tp('seratoCratesDesc')}</p>
            {/* La destinazione va dichiarata dove si scrive, non solo dove è
                innocuo: questa card modifica i file audio dell'utente. */}
            <SaveTargetNotice target="original" />
          </CardContent>
        </Card>
        {/* Engine DJ: genera una libreria NUOVA, mai una modifica della sua. */}
        <Card>
          <CardHeader>
            <CardTitle className="text-body font-semibold">{tp('engineExportTitle')}</CardTitle>
            <CardDescription>{tp('engineExportDesc')}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="secondary" onClick={doExportEngine} disabled={busy}>
              <Download /> {tp('engineExportBtn')}
            </Button>
            {syncFor('engine') && (
              <p className="mt-2 flex items-center gap-1.5 text-caption text-accent">
                <Waypoints className="size-3.5 shrink-0" />
                {tp('syncBadge', { sw: SOFTWARE_LABEL[syncOrigin as SoftwareId] })}
              </p>
            )}
            <SaveTargetNotice target="copy" />
          </CardContent>
        </Card>
      </div>

      {warnings.length > 0 && (
        <Notice variant="warning" title={tp('warnHeader')}>
          <ul className="list-disc space-y-1 pl-5">
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </Notice>
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
          {outcome}
        </Notice>
      )}
      {error && <Notice variant="destructive">{error}</Notice>}

      <GuideDialog kind="importXml" open={guideOpen} onOpenChange={setGuideOpen} />

      {/* Scrittura sugli originali: conferma forte con i numeri davanti.
          È lo stesso trattamento che ricevono quarantena ed eliminazione —
          non c'era motivo perché i tag Serato ne avessero uno più leggero. */}
      <DangerConfirmDialog
        open={seratoPlan !== null}
        onOpenChange={(o) => !o && setSeratoPlan(null)}
        title={tp('seratoConfirmTitle')}
        confirmWord="SCRIVI"
        confirmLabel={tp('seratoConfirmLabel', { n: seratoPlan?.files ?? 0 })}
        onConfirm={doExportSeratoCues}
        facts={[
          { label: tp('seratoFactFiles'), value: (seratoPlan?.files ?? 0).toLocaleString(locale) },
          { label: tp('seratoFactCues'), value: (seratoPlan?.cues ?? 0).toLocaleString(locale) },
          { label: tp('seratoFactLoops'), value: (seratoPlan?.loops ?? 0).toLocaleString(locale) },
          {
            label: tp('seratoFactScope'),
            value: convertSource ? tp('seratoScopeConverted') : tp('seratoScopeAll'),
            warn: !convertSource
          },
          {
            // Il writer preserva ciò che non interpreta, ma i CUE li
            // SOSTITUISCE: se l'utente aveva già segnato i suoi punti dentro
            // Serato, quelli spariscono. Va detto prima, non dopo.
            label: tp('seratoFactReplace'),
            value: tp('yes'),
            warn: true
          },
          { label: tp('seratoFactBackup'), value: tp('yes') }
        ]}
        description={<p>{tp('seratoConfirmBody')}</p>}
      />

      {/* Verso tutti: la conferma elenca le destinazioni una per una, con i
          loro numeri. Un pulsante che scrive tre file deve mostrarne tre. */}
      <Dialog open={allDir !== null} onOpenChange={(o) => !o && setAllDir(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tp('allConfirmTitle', { n: allTargets.length })}</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2 pt-1">
                <p className="text-caption text-ink-mid">{tp('allConfirmBody')}</p>
                <p className="break-all font-mono text-caption text-ink-lo">{allDir}</p>
              </div>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {allPlans.map(({ id, plan }) => (
              <div key={id} className="space-y-1.5">
                <Eyebrow>{SOFTWARE_LABEL[id]}</Eyebrow>
                {plan ? (
                  <SyncFacts plan={plan} locale={locale} tp={tp} />
                ) : (
                  <p className="text-caption text-ink-lo">{tp('syncOriginNone')}</p>
                )}
                {plan && plan.destroys && plan.lost > 0 && (
                  <Notice variant="warning" title={tp('syncLossTitle')}>
                    {tp('syncLossBody', {
                      fmt: SOFTWARE_LABEL[id],
                      n: plan.lost.toLocaleString(locale)
                    })}
                  </Notice>
                )}
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAllDir(null)}>
              {t(locale, 'common.cancel')}
            </Button>
            <Button variant="primary" onClick={() => void doExportAll()}>
              {tp('allBtn')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* limiti dichiarati: dialog non ignorabile prima di ogni export */}
      <Dialog open={pending !== null} onOpenChange={(o) => !o && setPending(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="size-5 shrink-0 text-warning" /> {tp('dlgTitle')}
            </DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2 pt-1">
                <ul className="list-disc space-y-1 pl-5 text-caption text-ink-mid">
                  {['limit1', 'limit2', 'limit3', 'limit4', 'limit5'].map((k) => (
                    <li key={k}>{tp(k)}</li>
                  ))}
                </ul>
                <p className="text-caption text-ink-mid">{tp('dlgNote')}</p>
                {/* Se questo export porta i punti di un'altra libreria, i conti
                    stanno qui: sono quelli della destinazione scelta davvero. */}
                {pendingPlan && (
                  <div className="space-y-2">
                    <SyncFacts plan={pendingPlan} locale={locale} tp={tp} />
                    {pendingPlan.destroys && pendingPlan.lost > 0 && (
                      <Notice variant="warning" title={tp('syncLossTitle')}>
                        {tp('syncLossBody', {
                          fmt: pending ? SOFTWARE_LABEL[pending as SoftwareId] : '',
                          n: pendingPlan.lost.toLocaleString(locale)
                        })}
                      </Notice>
                    )}
                  </div>
                )}
              </div>
            </DialogDescription>
          </DialogHeader>
          <label className="flex cursor-pointer items-start gap-2.5 text-caption text-ink-mid">
            <Checkbox
              className="mt-px"
              checked={acknowledged}
              onCheckedChange={(v) => setAcknowledged(v === true)}
            />
            {tp('ack')}
          </label>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPending(null)}>
              {t(locale, 'common.cancel')}
            </Button>
            <Button variant="primary" disabled={!acknowledged} onClick={doExport}>
              {tp('proceed')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
