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
  EmptyState,
  Input,
  Notice,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger
} from '@/components/ui/misc';
import { Field } from '@/components/ui/misc';
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
            <CardTitle className="text-body">{tp('optTitle')}</CardTitle>
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
            <CardTitle className="flex items-center gap-2 text-body">
              <Eye className="size-4" /> {tp('previewTitle')}
            </CardTitle>
            <CardDescription>{tp('previewDesc')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {viewPath ? (
              <ExcelViewer filePath={viewPath} />
            ) : (
              <EmptyState title={tp('noPreviewTitle')}>{tp('noPreviewBody')}</EmptyState>
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
}

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

  const doRead = async () => {
    const rb = await window.crateforge.rekordbox.defaultPaths();
    const dbPath = await window.crateforge.dialog.openFile(
      [{ name: 'Rekordbox master.db', extensions: ['db'] }],
      rb.masterDbExists ? rb.masterDb : rb.dir
    );
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
    setBusy(true);
    try {
      const r = (await run(tp('exportBtn'), () =>
        window.crateforge.siae.export(selected, outPath, venue || undefined, eventDate || undefined)
      )) as { rows: number; outPath: string };
      const text = tp('exportOk', { n: r.rows, path: r.outPath });
      setMsg({ kind: 'ok', text });
      push({ kind: 'success', job: true, title: tp('title'), body: text });
    } finally {
      setBusy(false);
    }
  };

  const current = sessions.find((s) => s.session_id === selected);

  return (
    <div className="space-y-4">
      <Notice variant="info" title={tp('howTitle')}>
        {tp('howBody')}
      </Notice>

      {mode === 'expert' && (
        <Notice variant="warning" title={tp('liveTitle')}>
          {tp('liveBody')}
        </Notice>
      )}

      <div className="grid gap-4 lg:grid-cols-[380px_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-body">{tp('step1')}</CardTitle>
            <CardDescription>{tp('step1Desc')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button variant="primary" onClick={doRead} working={busy}>
              <Database /> {tp('readBtn')}
            </Button>

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
            <CardTitle className="flex items-center gap-2 text-body">
              <CalendarClock className="size-4" /> {tp('sessionsTitle')}
            </CardTitle>
            <CardDescription>{tp('sessionsDesc')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {sessions.length === 0 ? (
              <EmptyState icon={<ListMusic />} title={tp('noSessionsTitle')}>
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
                      className={`flex w-full items-center gap-2 border-b border-line-subtle px-3 py-2 text-left transition-colors duration-press last:border-b-0 hover:bg-surface-hover ${
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
