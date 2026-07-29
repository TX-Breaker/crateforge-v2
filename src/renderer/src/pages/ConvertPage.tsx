import { useState } from 'react';
import { AlertTriangle, ArrowRightLeft, BookOpen, Download } from 'lucide-react';
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
import { Badge, Checkbox, Notice, Select } from '@/components/ui/misc';
import { GuideDialog } from '@/components/GuideDialog';
import { SaveTargetNotice } from '@/components/SaveTargetNotice';
import { RekordboxDiff } from '@/components/RekordboxDiff';
import { useAppState } from '@/lib/appState';
import { useJobs } from '@/lib/jobs';
import { useLibrary } from '@/lib/library';
import { useNotifications } from '@/lib/notifications';
import { pageText } from '@/lib/i18nPages';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';

type Format = 'rekordbox' | 'traktor' | 'virtualdj';

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

type SourceId = 'rekordbox-db' | 'rekordbox-xml' | 'traktor' | 'virtualdj' | 'engine' | 'serato';

const SOURCES: { id: SourceId; label: string; ext: string; udm: string }[] = [
  { id: 'rekordbox-db', label: 'Rekordbox (master.db)', ext: 'db', udm: 'masterdb' },
  { id: 'rekordbox-xml', label: 'Rekordbox (collection XML)', ext: 'xml', udm: 'xml' },
  { id: 'traktor', label: 'Traktor (.nml)', ext: 'nml', udm: 'traktor' },
  { id: 'virtualdj', label: 'VirtualDJ (database.xml)', ext: 'xml', udm: 'virtualdj' },
  { id: 'engine', label: 'Engine DJ (m.db)', ext: 'db', udm: 'engine' },
  { id: 'serato', label: 'Serato (_Serato_)', ext: '', udm: 'serato' }
];

type Cap = 'full' | 'partial' | 'none';

const MATRIX: { app: string; imp: Cap; impKey: string; exp: Cap; expKey: string }[] = [
  { app: 'Rekordbox', imp: 'full', impKey: 'rbImport', exp: 'full', expKey: 'rbExport' },
  { app: 'Traktor', imp: 'full', impKey: 'trImport', exp: 'full', expKey: 'trExport' },
  { app: 'VirtualDJ', imp: 'partial', impKey: 'vdjImport', exp: 'full', expKey: 'vdjExport' },
  { app: 'Engine DJ', imp: 'full', impKey: 'enImport', exp: 'partial', expKey: 'enExport' },
  { app: 'Serato', imp: 'full', impKey: 'srImport', exp: 'none', expKey: 'srExport' }
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
    { fieldKey: 'fLoops', cap: 'none', toKey: 'fNoEquiv' }
  ],
  traktor: [
    { fieldKey: 'fBasic', cap: 'full', toKey: 'fBasicTr' },
    { fieldKey: 'fBpmKey', cap: 'full', toKey: 'fBpmKeyTr' },
    { fieldKey: 'fCues', cap: 'partial', toKey: 'fCuesTr' },
    { fieldKey: 'fGrid', cap: 'partial', toKey: 'fGridTr' },
    { fieldKey: 'fPlaylists', cap: 'full', toKey: 'fPlaylistsTo' },
    { fieldKey: 'fSmart', cap: 'none', toKey: 'fNoEquiv' },
    { fieldKey: 'fMyTag', cap: 'none', toKey: 'fNoEquiv' },
    { fieldKey: 'fLoops', cap: 'none', toKey: 'fNoEquiv' }
  ],
  virtualdj: [
    { fieldKey: 'fBasic', cap: 'full', toKey: 'fBasicVdj' },
    { fieldKey: 'fBpmKey', cap: 'full', toKey: 'fBpmKeyVdj' },
    { fieldKey: 'fCues', cap: 'partial', toKey: 'fCuesVdj' },
    { fieldKey: 'fGrid', cap: 'partial', toKey: 'fGridVdj' },
    { fieldKey: 'fPlaylists', cap: 'full', toKey: 'fPlaylistsTo' },
    { fieldKey: 'fSmart', cap: 'none', toKey: 'fNoEquiv' },
    { fieldKey: 'fMyTag', cap: 'none', toKey: 'fNoEquiv' },
    { fieldKey: 'fLoops', cap: 'none', toKey: 'fNoEquiv' }
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
export function ConvertPage() {
  const { locale } = useAppState();
  const tp = (k: string, p?: Record<string, string | number>) =>
    pageText(locale, 'converter', k, p);
  const { run } = useJobs();
  const { refresh } = useLibrary();
  const { push } = useNotifications();

  const [pending, setPending] = useState<Format | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Avvisi del writer: ciò che non è rappresentabile va DETTO, non scartato.
  const [warnings, setWarnings] = useState<string[]>([]);
  const [guideOpen, setGuideOpen] = useState(false);
  const [srcSel, setSrcSel] = useState<SourceId>('rekordbox-db');
  const [dstSel, setDstSel] = useState<Format>('traktor');
  const [convertSource, setConvertSource] = useState<string | null>(null);

  const startExport = (fmt: Format) => {
    setConvertSource(null);
    setAcknowledged(false);
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
      const sel = convertSource ? { source: convertSource } : undefined;
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
    const sel = convertSource ? { source: convertSource } : undefined;
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
          <CardTitle className="flex items-center gap-2 text-body">
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

      {/* mappa dei campi: contenuto primario, non nota a piè di pagina */}
      <Card>
        <CardHeader>
          <CardTitle className="text-body">
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
          <CardTitle className="text-body">{tp('matrixTitle')}</CardTitle>
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
              <CardTitle className="text-body">{f.title}</CardTitle>
              <CardDescription>{tp(f.descKey)}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="secondary" onClick={() => startExport(f.id)} disabled={busy}>
                <Download /> {tp('exportBtn')}
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="opacity-80">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-body">
              Serato <Badge variant="neutral">{tp('comingSoon')}</Badge>
            </CardTitle>
            <CardDescription>{tp('seratoReason')}</CardDescription>
          </CardHeader>
        </Card>
        {/* Engine DJ: genera una libreria NUOVA, mai una modifica della sua. */}
        <Card>
          <CardHeader>
            <CardTitle className="text-body">{tp('engineExportTitle')}</CardTitle>
            <CardDescription>{tp('engineExportDesc')}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="secondary" onClick={doExportEngine} disabled={busy}>
              <Download /> {tp('engineExportBtn')}
            </Button>
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
