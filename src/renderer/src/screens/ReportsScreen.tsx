import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, Download, FileSpreadsheet, FolderOpen, History } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox, EmptyState, Input, Notice, Segmented, Select } from '@/components/ui/misc';
import { Disclosure, InfoTip, PageHeader, Section } from '@/components/ui/page';
import { ExcelViewer } from '@/components/ExcelViewer';
import { useAppState } from '@/lib/appState';
import { useJobs } from '@/lib/jobs';
import { useLibrary } from '@/lib/library';
import { useNotifications } from '@/lib/notifications';
import { useRouter } from '@/lib/router';
import { useT, type StrKey } from '@/lib/strings';
import { cn, formatClock } from '@/lib/utils';

/** Report: il file Excel della libreria, il borderò SIAE, la cronologia delle operazioni. */

type Tab = 'excel' | 'siae' | 'history';

export function ReportsScreen() {
  const t = useT();
  const { tab, setTab } = useRouter();
  const current: Tab = tab === 'siae' || tab === 'history' ? tab : 'excel';
  return (
    <div className="space-y-6">
      <PageHeader title={t('nav.reports')}>
        <Segmented
          value={current}
          onChange={(v) => setTab(v)}
          options={[
            { value: 'excel', label: t('rep.excel'), icon: <FileSpreadsheet /> },
            { value: 'siae', label: t('rep.siae') },
            { value: 'history', label: t('rep.history'), icon: <History /> }
          ]}
        />
      </PageHeader>
      {current === 'excel' && <Excel />}
      {current === 'siae' && <Siae />}
      {current === 'history' && <Log />}
    </div>
  );
}

function Excel() {
  const t = useT();
  const { locale } = useAppState();
  const { run } = useJobs();
  const { push } = useNotifications();
  const [camelot, setCamelot] = useState(true);
  const [byArtist, setByArtist] = useState(true);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<string | null>(null);

  const make = async () => {
    const out = (await window.crateforge.dialog.saveFile('crateforge-library.xlsx', [
      { name: 'Excel', extensions: ['xlsx'] }
    ])) as string | null;
    if (!out) return;
    setBusy(true);
    try {
      const r = (await run(t('rep.excelMake'), () =>
        window.crateforge.report.generate({ outPath: out, camelotNotation: camelot, groupByArtist: byArtist })
      )) as { rows: number; outPath: string };
      push({ kind: 'success', job: true, title: t('rep.excelDone', { n: r.rows.toLocaleString(locale) }), body: r.outPath });
      setView(r.outPath);
    } catch (e) {
      push({ kind: 'error', job: true, title: t('rep.excelMake'), body: String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <Section>
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Button size="lg" variant="primary" working={busy} onClick={make}>
              <FileSpreadsheet /> {t('rep.excelMake')}
            </Button>
            <InfoTip text={t('rep.excelTip')} />
          </div>
          <Disclosure>
            <label className="flex cursor-pointer items-center gap-2.5 text-body text-ink-hi">
              <Checkbox checked={camelot} onCheckedChange={(v) => setCamelot(v === true)} />
              {t('rep.camelot')}
            </label>
            <label className="flex cursor-pointer items-center gap-2.5 text-body text-ink-hi">
              <Checkbox checked={byArtist} onCheckedChange={(v) => setByArtist(v === true)} />
              {t('rep.byArtist')}
            </label>
          </Disclosure>
        </div>
      </Section>
      {view && <ExcelViewer filePath={view} />}
    </div>
  );
}

interface Night {
  session_id: string;
  session_name: string | null;
  session_date: string | null;
  tracks: number;
}

/** Sotto questa durata un brano è un sample, non un'opera riprodotta. */
const SAMPLE_UNDER_S = 30;

function Siae() {
  const t = useT();
  const { run } = useJobs();
  const { push } = useNotifications();
  const { rbPaths } = useLibrary();
  const [nights, setNights] = useState<Night[]>([]);
  const [selected, setSelected] = useState('');
  const [venue, setVenue] = useState('');
  const [date, setDate] = useState('');
  const [useWindow, setUseWindow] = useState(false);
  const [from, setFrom] = useState('21:00');
  const [to, setTo] = useState('06:00');
  const [dropSamples, setDropSamples] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const s = (await window.crateforge.siae.sessions()) as Night[];
    setNights(s);
    setSelected((cur) => (s.some((x) => x.session_id === cur) ? cur : (s[0]?.session_id ?? '')));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const read = async (pick: boolean) => {
    let db: string | null = rbPaths?.masterDbExists ? rbPaths.masterDb : null;
    if (pick || !db) {
      db = (await window.crateforge.dialog.openFile(
        [{ name: 'Rekordbox master.db', extensions: ['db'] }],
        rbPaths?.dir
      )) as string | null;
    }
    if (!db) return;
    setBusy(true);
    setError(null);
    try {
      const r = (await run(t('rep.siaeRead'), () => window.crateforge.siae.readHistory(db!))) as {
        ok: boolean;
        sessions?: number;
        rows?: number;
        message?: string;
      };
      if (!r.ok) setError(r.message ?? t('c.error'));
      else {
        push({ kind: 'success', title: t('rep.siaeReadOk', { sessions: r.sessions ?? 0, rows: r.rows ?? 0 }) });
        await load();
      }
    } finally {
      setBusy(false);
    }
  };

  const make = async () => {
    const night = nights.find((n) => n.session_id === selected);
    const out = (await window.crateforge.dialog.saveFile(
      `siae-${(night?.session_name ?? 'night').replace(/[^\w-]+/g, '_')}.xlsx`,
      [{ name: 'Excel', extensions: ['xlsx'] }]
    )) as string | null;
    if (!out) return;
    setBusy(true);
    try {
      const r = await run(t('rep.siaeMake'), () =>
        window.crateforge.siae.export({
          sessionId: selected,
          outPath: out,
          venue: venue || undefined,
          eventDate: date || undefined,
          fromTime: useWindow ? from : undefined,
          toTime: useWindow ? to : undefined,
          sampleUnderS: dropSamples ? SAMPLE_UNDER_S : 0
        })
      );
      /* Quanti sono stati tolti si dice sempre: è il numero che l'utente deve
         poter spiegare. */
      const notes = [
        t('rep.siaeCounts', { samples: r.samples, out: r.outOfWindow }),
        r.unknownTime > 0 ? t('rep.siaeNoTime', { n: r.unknownTime }) : null,
        r.outPath
      ].filter(Boolean);
      push({ kind: 'success', job: true, title: t('rep.siaeDone', { n: r.rows }), body: notes.join('\n') });
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant={nights.length ? 'secondary' : 'primary'} working={busy && !nights.length} onClick={() => read(false)}>
            <Download /> {t('rep.siaeRead')}
          </Button>
          <Button variant="ghost" onClick={() => read(true)}>
            {t('rep.siaeReadOther')}
          </Button>
          <InfoTip text={t('rep.siaeTip')} />
        </div>
        {error && <Notice variant="destructive">{error}</Notice>}

        {nights.length === 0 ? (
          <p className="text-caption text-ink-lo">{t('rep.siaeNone')}</p>
        ) : (
          <>
            <div className="grid gap-3 md:grid-cols-3">
              <div className="space-y-1.5">
                <div className="text-caption text-ink-mid">{t('rep.siaeNight')}</div>
                <Select
                  className="w-full"
                  value={selected}
                  label={t('rep.siaeNight')}
                  onValueChange={setSelected}
                  options={nights.map((n) => ({
                    value: n.session_id,
                    label: n.session_name ?? n.session_date ?? n.session_id,
                    hint: String(n.tracks)
                  }))}
                />
              </div>
              <div className="space-y-1.5">
                <div className="text-caption text-ink-mid">{t('rep.siaeVenue')}</div>
                <Input aria-label={t('rep.siaeVenue')} value={venue} onChange={(e) => setVenue(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <div className="text-caption text-ink-mid">{t('rep.siaeDate')}</div>
                <Input aria-label={t('rep.siaeDate')} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
            </div>
            <Disclosure>
              <label className="flex cursor-pointer items-center gap-2.5 text-body text-ink-hi">
                <Checkbox checked={dropSamples} onCheckedChange={(v) => setDropSamples(v === true)} />
                {t('rep.siaeSamples')}
              </label>
              <div className="flex flex-wrap items-center gap-2.5">
                <label className="flex cursor-pointer items-center gap-2.5 text-body text-ink-hi">
                  <Checkbox checked={useWindow} onCheckedChange={(v) => setUseWindow(v === true)} />
                  {t('rep.siaeWindow')}
                </label>
                <Input aria-label={`${t('rep.siaeWindow')} 1`} type="time" className="w-28" disabled={!useWindow} value={from} onChange={(e) => setFrom(e.target.value)} />
                <span className="text-ink-lo">→</span>
                <Input aria-label={`${t('rep.siaeWindow')} 2`} type="time" className="w-28" disabled={!useWindow} value={to} onChange={(e) => setTo(e.target.value)} />
              </div>
            </Disclosure>
            <Button size="lg" variant="primary" disabled={!selected} working={busy} onClick={make}>
              <FileSpreadsheet /> {t('rep.siaeMake')}
            </Button>
          </>
        )}
      </div>
    </Section>
  );
}

interface OplogRow {
  id: number;
  ts: string;
  operation: string;
  target: string | null;
  outcome: 'ok' | 'error' | 'dry-run' | 'skipped';
  detail: string | null;
}

const DOT: Record<OplogRow['outcome'], string> = {
  ok: 'bg-success',
  error: 'bg-destructive',
  'dry-run': 'bg-ink-lo',
  skipped: 'bg-warning'
};

function Log() {
  const t = useT();
  const { push } = useNotifications();
  const [rows, setRows] = useState<OplogRow[] | null>(null);
  const [filter, setFilter] = useState<'all' | 'failures'>('all');
  const [open, setOpen] = useState<Set<number>>(new Set());

  useEffect(() => {
    void window.crateforge.oplog.list(500).then((r) => {
      const list = r as OplogRow[];
      setRows(list);
      // Gli errori si aprono da soli: non devono stare a un clic dall'essere ignorati.
      setOpen(new Set(list.filter((x) => x.outcome === 'error').slice(0, 5).map((x) => x.id)));
    });
  }, []);

  const exportLog = async () => {
    const out = (await window.crateforge.dialog.saveFile('crateforge-log.txt', [
      { name: 'Text', extensions: ['txt'] }
    ])) as string | null;
    if (!out) return;
    await window.crateforge.oplog.exportTxt(out);
    push({ kind: 'success', title: t('rep.logExported'), body: out });
  };

  if (rows && rows.length === 0) {
    return <EmptyState icon={<History />} title={t('rep.logEmpty')} action={null} />;
  }

  const shown = (rows ?? []).filter((r) => filter === 'all' || r.outcome === 'error');

  return (
    <Section
      actions={
        <>
          <Segmented
            size="sm"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: t('rep.all') },
              { value: 'failures', label: t('rep.failures') }
            ]}
          />
          <Button size="sm" variant="ghost" onClick={exportLog}>
            <Download /> {t('rep.exportLog')}
          </Button>
        </>
      }
    >
      <ul className="divide-y divide-line-subtle">
        {shown.map((r) => {
          const isOpen = open.has(r.id);
          return (
            <li key={r.id}>
              <button
                onClick={() =>
                  setOpen((p) => {
                    const next = new Set(p);
                    if (next.has(r.id)) next.delete(r.id);
                    else next.add(r.id);
                    return next;
                  })
                }
                className="flex w-full items-center gap-3 py-2 text-left transition-colors duration-press hover:bg-surface-hover"
              >
                <span className={cn('size-2 shrink-0 rounded-full', DOT[r.outcome])} />
                <span className="w-24 shrink-0 font-mono text-caption tabular-nums text-ink-lo">{formatClock(r.ts)}</span>
                <span className="min-w-0 flex-1 truncate text-body text-ink-hi">
                  {r.operation}
                  {r.target && <span className="text-ink-lo"> · {r.target}</span>}
                </span>
                <span className="w-20 shrink-0 text-right text-caption text-ink-mid">{t(`rep.o.${r.outcome}` as StrKey)}</span>
                <ChevronDown className={cn('size-3.5 shrink-0 text-ink-lo transition-transform', isOpen && 'rotate-180')} />
              </button>
              {isOpen && (
                <div className="space-y-2 pb-3 pl-5">
                  <p className="whitespace-pre-wrap break-words font-mono text-caption text-ink-mid" data-selectable>
                    {r.ts}
                    {'\n'}
                    {r.detail ?? '—'}
                  </p>
                  {r.target && (
                    <Button size="sm" variant="ghost" onClick={() => window.crateforge.shell.showFolder(r.target!)}>
                      <FolderOpen /> {t('c.openFolder')}
                    </Button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
