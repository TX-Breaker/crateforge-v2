import { useEffect, useState } from 'react';
import { CalendarClock, Database, Eye, FileSpreadsheet, ListMusic, Receipt } from 'lucide-react';
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
import {
  Checkbox,
  EmptyState,
  Field,
  Input,
  Notice,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger
} from '@/components/ui/misc';
import { ExcelViewer } from '@/components/ExcelViewer';
import { SaveTargetNotice } from '@/components/SaveTargetNotice';
import { RekordboxDiff } from '@/components/RekordboxDiff';
import { useAppState } from '@/lib/appState';
import { useJobs } from '@/lib/jobs';
import { useNotifications } from '@/lib/notifications';
import { useRouter } from '@/lib/router';
import { pageText } from '@/lib/i18nPages';

/**
 * Report — due pagine V1 in una destinazione. Stessa forma tutte e due le
 * volte: si configura a sinistra, si vedono le righe vere a destra, perché un
 * report che non puoi vedere in anteprima è un report che fai due volte.
 */
export function ReportsPage() {
  const { locale } = useAppState();
  const { tab, setTab } = useRouter();
  return (
    <Tabs value={tab ?? 'excel'} onValueChange={setTab}>
      <TabsList>
        <TabsTrigger value="excel">
          <FileSpreadsheet /> {pageText(locale, 'tabs', 'excel')}
        </TabsTrigger>
        <TabsTrigger value="siae">
          <Receipt /> {pageText(locale, 'tabs', 'siae')}
        </TabsTrigger>
      </TabsList>
      <TabsContent value="excel">
        <ExcelTab />
      </TabsContent>
      <TabsContent value="siae">
        <SiaeTab />
      </TabsContent>
    </Tabs>
  );
}

function ExcelTab() {
  const { locale } = useAppState();
  const tp = (k: string, p?: Record<string, string | number>) => pageText(locale, 'report', k, p);
  const { run } = useJobs();
  const { push } = useNotifications();

  const [camelot, setCamelot] = useState(true);
  const [groupByArtist, setGroupByArtist] = useState(true);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewPath, setViewPath] = useState<string | null>(null);

  const doGenerate = async () => {
    const outPath = await window.crateforge.dialog.saveFile('libreria-crateforge.xlsx', [
      { name: 'Cartella di lavoro Excel', extensions: ['xlsx'] }
    ]);
    if (!outPath) return;
    setError(null);
    setOutcome(null);
    setBusy(true);
    try {
      const r = await run(tp('jobGenerate'), () =>
        window.crateforge.report.generate({
          outPath,
          camelotNotation: camelot,
          groupByArtist
        })
      );
      const text = tp('outDone', { n: r.rows.toLocaleString(locale), path: r.outPath });
      setOutcome(text);
      setViewPath(r.outPath);
      push({ kind: 'success', job: true, title: tp('title'), body: text });
    } catch (err) {
      setError(String(err));
      push({ kind: 'error', job: true, title: tp('title'), body: String(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <RekordboxDiff page="report" />

      <div className="grid gap-4 lg:grid-cols-[380px_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-body font-semibold">{tp('optTitle')}</CardTitle>
            <CardDescription>{tp('optDesc')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <label className="flex items-center justify-between gap-4">
              <span>
                <span className="block text-body text-ink-hi">{tp('camelotLabel')}</span>
                <span className="block text-caption text-ink-lo">{tp('camelotHint')}</span>
              </span>
              <Switch checked={camelot} onCheckedChange={setCamelot} />
            </label>
            <label className="flex items-center justify-between gap-4 border-t border-line-subtle pt-3">
              <span>
                <span className="block text-body text-ink-hi">{tp('groupLabel')}</span>
                <span className="block text-caption text-ink-lo">{tp('groupHint')}</span>
              </span>
              <Switch checked={groupByArtist} onCheckedChange={setGroupByArtist} />
            </label>
            <SaveTargetNotice target="copy" />
            <Button variant="primary" onClick={doGenerate} working={busy}>
              <FileSpreadsheet /> {tp('generateBtn')}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-body font-semibold">
              <Eye className="size-4" /> {tp('previewTitle')}
            </CardTitle>
            <CardDescription>{tp('previewDesc')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {viewPath ? (
              <ExcelViewer filePath={viewPath} />
            ) : (
              <EmptyState
                title={tp('noPreviewTitle')}
                action={
                  <Button variant="primary" onClick={doGenerate} working={busy}>
                    <FileSpreadsheet /> {tp('noPreviewAction')}
                  </Button>
                }
              >
                {tp('noPreviewBody')}
              </EmptyState>
            )}
          </CardContent>
        </Card>
      </div>

      {outcome && <Notice variant="success">{outcome}</Notice>}
      {error && <Notice variant="destructive">{error}</Notice>}
    </div>
  );
}

interface HistorySession {
  session_id: string;
  session_name: string | null;
  session_date: string | null;
  tracks: number;
  first_played_at: string | null;
  last_played_at: string | null;
}

/** Sotto questa durata un brano è un sample, non un'opera riprodotta. */
const SAMPLE_UNDER_S = 30;

function SiaeTab() {
  const { locale, mode } = useAppState();
  const tp = (k: string, p?: Record<string, string | number>) => pageText(locale, 'siae', k, p);
  const { run } = useJobs();
  const { push } = useNotifications();

  const [sessions, setSessions] = useState<HistorySession[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [venue, setVenue] = useState('');
  const [eventDate, setEventDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [note, setNote] = useState<string | null>(null);

  /* La cronologia sta dentro l'installazione di Rekordbox: se il programma è su
     questo computer, il file lo sappiamo già. Chiederlo lo stesso significava
     far cercare all'utente un master.db dentro AppData — cioè fargli fare la
     parte che il programma può fare da solo. */
  const [rbPath, setRbPath] = useState<string | null>(null);

  /* Fascia oraria della serata. I valori predefiniti sono quelli di una serata
     vera, e passano la mezzanotte: 21:00 → 06:00 del giorno dopo. */
  const [useWindow, setUseWindow] = useState(false);
  const [fromTime, setFromTime] = useState('21:00');
  const [toTime, setToTime] = useState('06:00');
  const [dropSamples, setDropSamples] = useState(true);

  useEffect(() => {
    void window.crateforge.rekordbox
      .defaultPaths()
      .then((rb) => setRbPath(rb.masterDbExists ? rb.masterDb : null))
      .catch(() => setRbPath(null));
  }, []);

  const refreshSessions = async () => {
    const s = (await window.crateforge.siae.sessions()) as HistorySession[];
    setSessions(s);
    if (s.length && !s.some((x) => x.session_id === selected)) setSelected(s[0].session_id);
  };

  /* Le serate gia' lette restano nell'archivio interno fra un avvio e l'altro:
     senza questa lettura all'apertura la scheda si presentava vuota, e l'utente
     concludeva che i suoi dati fossero spariti. Difetto ereditato dalla V1. */
  useEffect(() => {
    void refreshSessions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** `pick` = l'utente vuole scegliere il file a mano invece del rilevato. */
  const doRead = async (pick = false) => {
    let dbPath: string | null = rbPath;
    if (pick || !dbPath) {
      const rb = await window.crateforge.rekordbox.defaultPaths();
      dbPath = await window.crateforge.dialog.openFile(
        [{ name: 'Rekordbox master.db', extensions: ['db'] }],
        rb.masterDbExists ? rb.masterDb : rb.dir
      );
    }
    if (!dbPath) return;
    setMsg(null);
    setBusy(true);
    try {
      const r = (await run(tp('readBtn'), () => window.crateforge.siae.readHistory(dbPath))) as {
        ok: boolean;
        sessions?: number;
        rows?: number;
        message?: string;
      };
      if (r.ok) {
        setMsg({
          kind: 'ok',
          text: tp('readOk', { sessions: r.sessions ?? 0, rows: r.rows ?? 0 })
        });
        await refreshSessions();
      } else {
        setMsg({ kind: 'err', text: tp('readErr', { msg: r.message ?? '?' }) });
      }
    } finally {
      setBusy(false);
    }
  };

  const doExport = async () => {
    if (!selected) return;
    const sess = sessions.find((s) => s.session_id === selected);
    const suggested = `siae-${(sess?.session_name ?? 'serata').replace(/[^\w-]+/g, '_')}.xlsx`;
    const outPath = await window.crateforge.dialog.saveFile(suggested, [
      { name: 'Excel', extensions: ['xlsx'] }
    ]);
    if (!outPath) return;
    setMsg(null);
    setNote(null);
    setBusy(true);
    try {
      const r = await run(tp('exportBtn'), () =>
        window.crateforge.siae.export({
          sessionId: selected,
          outPath,
          venue: venue || undefined,
          eventDate: eventDate || undefined,
          fromTime: useWindow ? fromTime : undefined,
          toTime: useWindow ? toTime : undefined,
          sampleUnderS: dropSamples ? SAMPLE_UNDER_S : 0
        })
      );
      /* Quanti sono entrati E quanti sono stati tolti: il secondo numero è
         quello che l'utente deve poter spiegare, quindi si mostra sempre. */
      const text =
        tp('exportOk', { n: r.rows, path: r.outPath }) +
        ' ' +
        tp('exportCounts', { n: r.rows, samples: r.samples, out: r.outOfWindow });
      setMsg({ kind: 'ok', text });
      if (r.unknownTime > 0) setNote(tp('exportNoTime', { n: r.unknownTime }));
      push({ kind: 'success', job: true, title: tp('title'), body: text });
    } finally {
      setBusy(false);
    }
  };

  /** Una fascia che finisce prima di quando comincia passa la mezzanotte. */
  const crossesMidnight = useWindow && toTime <= fromTime;

  const current = sessions.find((s) => s.session_id === selected);

  return (
    <div className="space-y-4">
      <Notice variant="info" title={tp('howTitle')}>
        {tp('howBody')} {tp('onlyRekordbox')}
      </Notice>

      {note && <Notice variant="warning">{note}</Notice>}

      {mode === 'expert' && (
        <Notice variant="warning" title={tp('liveTitle')}>
          {tp('liveBody')}
        </Notice>
      )}

      <div className="grid gap-4 lg:grid-cols-[380px_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-body font-semibold">{tp('step1')}</CardTitle>
            <CardDescription>{tp('step1Desc')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button variant="primary" onClick={() => void doRead()} working={busy}>
              <Database /> {rbPath ? tp('readFrom', { sw: 'Rekordbox' }) : tp('readBtn')}
            </Button>
            <p className="text-caption text-ink-lo">
              {rbPath ? tp('readDetected') : tp('readNotFound')}
            </p>
            {rbPath && (
              <>
                <p className="break-all font-mono text-caption text-ink-lo">{rbPath}</p>
                <Button variant="ghost" size="sm" onClick={() => void doRead(true)} disabled={busy}>
                  {tp('readOther')}
                </Button>
              </>
            )}

            {/* Fascia oraria: la serata, non il giorno di calendario. */}
            <div className="space-y-2 rounded-card border border-line p-3">
              <label className="flex cursor-pointer items-start gap-2.5 text-caption text-ink-mid">
                <Checkbox
                  className="mt-px"
                  checked={useWindow}
                  onCheckedChange={(v) => setUseWindow(v === true)}
                />
                <span>
                  <span className="text-ink-hi">{tp('windowOn')}</span>
                  <br />
                  {tp('windowDesc')}
                </span>
              </label>
              {useWindow && (
                <div className="flex flex-wrap items-end gap-3">
                  <Field label={tp('windowFrom')}>
                    <Input
                      type="time"
                      value={fromTime}
                      onChange={(e) => setFromTime(e.target.value)}
                      mono
                    />
                  </Field>
                  <Field label={tp('windowTo')}>
                    <Input
                      type="time"
                      value={toTime}
                      onChange={(e) => setToTime(e.target.value)}
                      mono
                    />
                  </Field>
                </div>
              )}
              {crossesMidnight && (
                <p className="text-caption text-accent">{tp('windowCrosses')}</p>
              )}
            </div>

            {/* Sample: si escludono, ma il numero finisce nel foglio. */}
            <label className="flex cursor-pointer items-start gap-2.5 text-caption text-ink-mid">
              <Checkbox
                className="mt-px"
                checked={dropSamples}
                onCheckedChange={(v) => setDropSamples(v === true)}
              />
              <span>
                <span className="text-ink-hi">{tp('sampleOn', { n: SAMPLE_UNDER_S })}</span>
                <br />
                {tp('sampleDesc')}
              </span>
            </label>

            <Field label={tp('fVenue')}>
              <Input value={venue} onChange={(e) => setVenue(e.target.value)} placeholder={tp('fVenuePh')} />
            </Field>
            <Field label={tp('fDate')}>
              <Input
                type="date"
                value={eventDate}
                onChange={(e) => setEventDate(e.target.value)}
                mono
              />
            </Field>

            <SaveTargetNotice target="copy" />
            <Button variant="primary" onClick={doExport} disabled={!selected} working={busy}>
              <FileSpreadsheet /> {tp('exportBtn')}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-body font-semibold">
              <CalendarClock className="size-4" /> {tp('sessionsTitle')}
            </CardTitle>
            <CardDescription>{tp('sessionsDesc')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {sessions.length === 0 ? (
              <EmptyState
                icon={<ListMusic />}
                title={tp('noSessionsTitle')}
                action={
                  <Button variant="secondary" onClick={() => void refreshSessions()}>
                    <CalendarClock /> {tp('noSessionsAction')}
                  </Button>
                }
              >
                {tp('noSessionsBody')}
              </EmptyState>
            ) : (
              <>
                {current && (
                  <div className="grid grid-cols-2 gap-3">
                    <StatTile
                      label={tp('statTracks')}
                      value={current.tracks.toLocaleString(locale)}
                    />
                    <StatTile
                      label={tp('statDate')}
                      value={current.session_date ?? '—'}
                    />
                  </div>
                )}
                <div className="max-h-80 overflow-auto rounded-card border border-line-subtle">
                  {sessions.map((s) => (
                    <button
                      key={s.session_id}
                      onClick={() => setSelected(s.session_id)}
                      /* Densità globale (§8.4), come le altre liste. */
                      style={{ height: 'var(--row-h)', fontSize: 'var(--row-font)' }}
                      className={`flex w-full items-center gap-2 border-b border-line-subtle px-3 text-left transition-colors duration-press last:border-b-0 hover:bg-surface-hover ${
                        selected === s.session_id ? 'bg-accent/10' : ''
                      }`}
                    >
                      <span className="min-w-0 flex-1 truncate text-caption text-ink-hi">
                        {s.session_name ?? s.session_id}
                      </span>
                      <span className="shrink-0 font-mono text-caption tabular-nums text-ink-lo">
                        {s.session_date ?? '—'}
                      </span>
                      <span className="w-12 shrink-0 text-right font-mono text-caption tabular-nums text-ink-mid">
                        {s.tracks}
                      </span>
                    </button>
                  ))}
                </div>
                <Eyebrow>{tp('previewNote')}</Eyebrow>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {msg && <Notice variant={msg.kind === 'err' ? 'destructive' : 'success'}>{msg.text}</Notice>}
    </div>
  );
}
