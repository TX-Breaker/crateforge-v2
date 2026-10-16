import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2, ChevronUp, Loader2, XCircle, XOctagon } from 'lucide-react';
import { cn, formatElapsed } from '@/lib/utils';
import { useAppState } from '@/lib/appState';
import { useJobs } from '@/lib/jobs';
import { useT, type StrKey } from '@/lib/strings';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/misc';

/**
 * Barra job globale (§3, 46px). Compare solo mentre c'è lavoro in corso e non
 * si smonta al cambio rotta: fase, progresso determinato o indeterminato,
 * done/total, ETA, annulla, coda espandibile.
 */
const PHASE_KEYS: Record<string, StrKey> = {
  scan: 'phase.scan',
  copy: 'phase.copy',
  'ingest-xml': 'phase.ingestXml',
  'ingest-masterdb': 'phase.ingestMasterdb',
  'orphan-scan': 'phase.orphanScan',
  excel: 'phase.excel',
  'relocate-scan': 'phase.relocateScan',
  fingerprint: 'phase.fingerprint',
  dedup: 'phase.dedup',
  cues: 'phase.cues',
  tagger: 'phase.tagger',
  stems: 'phase.stems',
  verify: 'phase.verify'
};

export function JobBar() {
  const { locale } = useAppState();
  const t = useT();
  const { running, queue, history, percent, etaS, cancel } = useJobs();
  const [expanded, setExpanded] = useState(false);

  const visible = running !== null || queue.length > 0;

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.22, ease: [0.2, 0, 0, 1] }}
          className="shrink-0 overflow-hidden border-t border-line-subtle bg-surface-1"
        >
          <div className="flex h-jobbar items-center gap-4 px-6">
            <Loader2 className="size-4 shrink-0 animate-spin text-accent" />

            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="truncate text-body font-medium text-ink-hi">
                  {running?.label ?? queue[0]?.label}
                </span>
                {running?.progress && (
                  <span className="truncate text-caption text-ink-lo">
                    ·{' '}
                    {PHASE_KEYS[running.progress.phase]
                      ? t(PHASE_KEYS[running.progress.phase])
                      : running.progress.phase}
                  </span>
                )}
              </div>
              <Progress className="mt-1" value={percent} />
            </div>

            <div className="flex shrink-0 items-center gap-4 font-mono text-caption tabular-nums text-ink-mid">
              {running?.progress && running.progress.total > 0 && (
                <span>
                  {running.progress.done.toLocaleString(locale)} /{' '}
                  {running.progress.total.toLocaleString(locale)}
                </span>
              )}
              {running?.progress && running.progress.total === 0 && running.progress.done > 0 && (
                <span>{running.progress.done.toLocaleString(locale)}</span>
              )}
              {etaS !== null && (
                <span className="text-ink-lo">
                  {t('job.eta')} {formatElapsed(etaS)}
                </span>
              )}
            </div>

            {running?.cancellable && (
              <Button size="sm" variant="ghost" onClick={cancel}>
                <XOctagon /> {t('c.cancel')}
              </Button>
            )}

            <button
              onClick={() => setExpanded((v) => !v)}
              className="flex shrink-0 items-center gap-1.5 rounded-control px-2 py-1 text-caption text-ink-lo transition-colors duration-press hover:bg-surface-hover hover:text-ink-mid"
            >
              {queue.length > 0 && (
                <span className="font-mono tabular-nums">
                  +{queue.length} {t('job.queued')}
                </span>
              )}
              <ChevronUp
                className={cn('size-3.5 transition-transform duration-swap', expanded && 'rotate-180')}
              />
            </button>
          </div>

          <AnimatePresence>
            {expanded && (
              <motion.div
                initial={{ height: 0 }}
                animate={{ height: 'auto' }}
                exit={{ height: 0 }}
                transition={{ duration: 0.18, ease: 'easeOut' }}
                className="overflow-hidden border-t border-line-subtle"
              >
                <div className="max-h-52 space-y-px overflow-y-auto px-6 py-2">
                  {queue.map((j) => (
                    <div
                      key={j.id}
                      className="flex items-center gap-2 py-1 text-caption text-ink-mid"
                    >
                      <span className="size-1.5 rounded-full bg-ink-lo" />
                      {j.label}
                      <span className="ml-auto text-ink-lo">{t('job.waiting')}</span>
                    </div>
                  ))}
                  {history.slice(0, 6).map((h) => (
                    <div
                      key={h.id}
                      className="flex items-center gap-2 py-1 text-caption text-ink-lo"
                    >
                      {h.outcome === 'done' ? (
                        <CheckCircle2 className="size-3 text-success" />
                      ) : (
                        <XCircle className="size-3 text-destructive" />
                      )}
                      {h.label}
                      <span className="ml-auto font-mono tabular-nums">
                        {formatElapsed(h.durationS)}
                      </span>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
