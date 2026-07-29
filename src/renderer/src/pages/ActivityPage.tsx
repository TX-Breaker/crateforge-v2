import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, Download, FolderOpen, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge, EmptyState, FilterChip, KeyValue } from '@/components/ui/misc';
import { SaveTargetBadge, type SaveTarget } from '@/components/SaveTargetNotice';
import { useAppState } from '@/lib/appState';
import { useNotifications } from '@/lib/notifications';
import { useRouter } from '@/lib/router';
import { pageText } from '@/lib/i18nPages';
import { cn, formatClock } from '@/lib/utils';

interface OplogRow {
  id: number;
  ts: string;
  operation: string;
  target: string | null;
  outcome: 'ok' | 'error' | 'dry-run' | 'skipped';
  detail: string | null;
}

type Filter = 'all' | 'backup' | 'import' | 'cleanup' | 'export' | 'failures';

/**
 * Attività — il registro permanente. Ogni operazione atterra qui, riuscita o
 * no, con la destinazione di scrittura che ha usato: è la pagina che rende la
 * promessa di sicurezza verificabile invece che retorica, ed è il motivo per
 * cui i toast possono permettersi di essere brevi.
 */
export function ActivityPage() {
  const { locale } = useAppState();
  const { go } = useRouter();
  const tp = (k: string, p?: Record<string, string | number>) => pageText(locale, 'log', k, p);
  const { push } = useNotifications();
  const [rows, setRows] = useState<OplogRow[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [open, setOpen] = useState<Set<number>>(new Set());

  const load = async () => setRows((await window.crateforge.oplog.list(500)) as OplogRow[]);
  useEffect(() => {
    load();
  }, []);

  // Le voci che falliscono si aprono da sole: un errore non deve mai stare a
  // un clic di distanza dall'essere ignorato.
  useEffect(() => {
    setOpen(new Set(rows.filter((r) => r.outcome === 'error').map((r) => r.id)));
  }, [rows]);

  const exportLog = async () => {
    const outPath = await window.crateforge.dialog.saveFile('crateforge-log.txt', [
      { name: 'Text', extensions: ['txt'] }
    ]);
    if (!outPath) return;
    await window.crateforge.oplog.exportTxt(outPath);
    push({ kind: 'success', title: tp('title'), body: tp('exported', { path: outPath }) });
  };

  const shown = useMemo(() => {
    if (filter === 'all') return rows;
    if (filter === 'failures') return rows.filter((r) => r.outcome === 'error');
    const prefix: Record<Exclude<Filter, 'all' | 'failures'>, string[]> = {
      backup: ['backup'],
      import: ['library', 'sidecar', 'inbox'],
      cleanup: ['orphans', 'dedup', 'relocator'],
      export: ['export', 'report', 'siae', 'setbuilder', 'masterdb', 'cues', 'tagger', 'stems']
    };
    return rows.filter((r) => prefix[filter].some((p) => r.operation.startsWith(p)));
  }, [rows, filter]);

  /** Destinazione di scrittura dedotta dall'operazione registrata. */
  const targetOf = (op: string): SaveTarget => {
    if (op.startsWith('masterdb')) return 'masterdb';
    // I cue Serato finiscono DENTRO i file audio: è una scrittura sugli
    // originali, non un export. Prima prendeva il badge 'XML — file da
    // importare', che è il contrario di quello che è successo.
    if (op.includes('serato-cues')) return 'original';
    if (op.includes('serato-crates')) return 'copy';
    if (op.includes('write-tags') || op.includes('original')) return 'original';
    if (op.startsWith('export') || op.includes('xml') || op.startsWith('setbuilder')) return 'xml';
    if (op.startsWith('backup') || op.startsWith('orphans') || op.startsWith('report') || op.startsWith('siae'))
      return 'copy';
    return 'udm';
  };

  const outcomeVariant: Record<OplogRow['outcome'], 'success' | 'destructive' | 'neutral' | 'warning'> = {
    ok: 'success',
    error: 'destructive',
    'dry-run': 'neutral',
    skipped: 'warning'
  };
  const outcomeKey: Record<OplogRow['outcome'], string> = {
    ok: 'outcomeOk',
    error: 'outcomeError',
    'dry-run': 'outcomeDry',
    skipped: 'outcomeSkipped'
  };

  const filters: { id: Filter; label: string }[] = [
    { id: 'all', label: tp('fAll') },
    { id: 'backup', label: tp('fBackup') },
    { id: 'import', label: tp('fImport') },
    { id: 'cleanup', label: tp('fCleanup') },
    { id: 'export', label: tp('fExport') },
    { id: 'failures', label: tp('fFailures') }
  ];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex-row items-center justify-between gap-4">
          <div>
            <CardTitle className="text-body font-semibold">
              {tp('countTitle', { n: rows.length.toLocaleString(locale) })}
            </CardTitle>
            <CardDescription>{tp('retention')}</CardDescription>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button size="sm" variant="secondary" onClick={load}>
              <RefreshCw /> {tp('refresh')}
            </Button>
            <Button size="sm" variant="secondary" onClick={exportLog}>
              <Download /> {tp('export')}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {filters.map((f) => (
              <FilterChip key={f.id} active={filter === f.id} onClick={() => setFilter(f.id)}>
                {f.label}
              </FilterChip>
            ))}
          </div>

          {shown.length === 0 ? (
            <EmptyState
              title={tp('emptyTitle')}
              action={
                <Button variant="secondary" onClick={() => go('health')}>
                  {tp('emptyAction')}
                </Button>
              }
            >
              {tp('emptyBody')}
            </EmptyState>
          ) : (
            <div className="overflow-hidden rounded-card border border-line-subtle">
              <div className="flex items-center gap-3 border-b border-line-subtle bg-surface-3 px-3 py-1.5 font-mono text-[9.5px] uppercase tracking-[.12em] text-ink-lo">
                <span className="w-12 shrink-0">{tp('colWhen')}</span>
                <span className="w-20 shrink-0">{tp('colTarget')}</span>
                <span className="flex-1">{tp('colOp')}</span>
                <span className="w-24 shrink-0">{tp('colOutcome')}</span>
                <span className="w-16 shrink-0 text-right">{tp('colEntry')}</span>
              </div>

              <div className="max-h-[32rem] overflow-y-auto">
                {shown.map((r) => {
                  const isOpen = open.has(r.id);
                  return (
                    <div key={r.id} className="border-b border-line-subtle last:border-b-0">
                      <button
                        onClick={() =>
                          setOpen((prev) => {
                            const next = new Set(prev);
                            next.has(r.id) ? next.delete(r.id) : next.add(r.id);
                            return next;
                          })
                        }
                        className="flex w-full items-center gap-3 px-3 py-1.5 text-left transition-colors duration-press hover:bg-surface-hover"
                      >
                        <span className="w-12 shrink-0 font-mono text-caption tabular-nums text-ink-lo">
                          {formatClock(r.ts)}
                        </span>
                        <span className="w-20 shrink-0">
                          <SaveTargetBadge target={targetOf(r.operation)} />
                        </span>
                        <span className="min-w-0 flex-1 truncate text-caption text-ink-hi">
                          {r.operation}
                          {r.target && <span className="text-ink-lo"> · {r.target}</span>}
                        </span>
                        <span className="w-24 shrink-0">
                          <Badge variant={outcomeVariant[r.outcome]}>
                            {tp(outcomeKey[r.outcome])}
                          </Badge>
                        </span>
                        <span className="flex w-16 shrink-0 items-center justify-end gap-1 font-mono text-caption tabular-nums text-ink-lo">
                          #{r.id}
                          <ChevronDown
                            className={cn(
                              'size-3 transition-transform duration-swap',
                              isOpen && 'rotate-180'
                            )}
                          />
                        </span>
                      </button>

                      {isOpen && (
                        <div className="grid gap-3 border-t border-line-subtle bg-surface-3 px-3 py-2.5 sm:grid-cols-4">
                          <KeyValue label={tp('kWhen')} value={r.ts} />
                          <KeyValue label={tp('kOperation')} value={r.operation} />
                          <KeyValue label={tp('kTarget')} value={r.target ?? '—'} />
                          <KeyValue
                            label={tp('kOutcome')}
                            value={tp(outcomeKey[r.outcome])}
                            tone={r.outcome === 'error' ? 'destructive' : undefined}
                          />
                          <div className="sm:col-span-4">
                            <div className="font-mono text-eyebrow uppercase text-ink-lo">
                              {tp('kDetail')}
                            </div>
                            <p
                              className="whitespace-pre-wrap break-words font-mono text-caption text-ink-mid"
                              data-selectable
                            >
                              {r.detail ?? '—'}
                            </p>
                          </div>
                          {r.target && (
                            <div className="sm:col-span-4">
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => window.crateforge.shell.showFolder(r.target!)}
                              >
                                <FolderOpen /> {tp('openTarget')}
                              </Button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
