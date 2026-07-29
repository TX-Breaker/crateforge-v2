import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';

/**
 * Coda job globale (§6.2 del prompt di redesign, §3 "shell" del design system).
 *
 * Il progresso non vive più dentro la card della pagina: la barra job è una
 * striscia persistente della shell e sopravvive al cambio di rotta. Il main
 * esegue un job per volta ed emette `job:progress`; qui sopra ci costruiamo:
 *   - il job in corso, con fase, done/total, ETA calcolata sul ritmo reale;
 *   - una coda vera (le operazioni successive partono quando la prima finisce);
 *   - lo storico degli ultimi esiti, che alimenta il centro notifiche.
 *
 * `cancel()` chiama `jobs.cancel` sul main e svuota la coda in attesa: annullare
 * deve fermare tutto quello che l'utente ha chiesto, non solo il job corrente.
 */

export type JobOutcome = 'done' | 'failed' | 'cancelled';

export interface JobProgress {
  phase: string;
  done: number;
  total: number;
}

export interface RunningJob {
  id: string;
  /** etichetta già localizzata, es. "Backup smart" */
  label: string;
  startedAt: number;
  progress: JobProgress | null;
  cancellable: boolean;
}

export interface QueuedJob {
  id: string;
  label: string;
}

export interface FinishedJob {
  id: string;
  label: string;
  outcome: JobOutcome;
  at: number;
  durationS: number;
  detail?: string;
}

interface JobsApi {
  running: RunningJob | null;
  queue: QueuedJob[];
  history: FinishedJob[];
  /** percentuale 0-100, oppure null se il totale non è noto */
  percent: number | null;
  /** secondi stimati alla fine, null se non stimabile */
  etaS: number | null;
  cancel: () => void;
  /**
   * Accoda un'operazione. Il risultato della promise viene restituito al
   * chiamante; la barra si occupa solo di raccontare cosa sta succedendo.
   */
  run: <T>(
    label: string,
    fn: () => Promise<T>,
    opts?: { cancellable?: boolean; detail?: (r: T) => string }
  ) => Promise<T>;
  /** true finché c'è lavoro in corso o accodato */
  busy: boolean;
}

const Ctx = createContext<JobsApi | null>(null);

let seq = 0;
const nextId = () => `job-${++seq}`;

export function JobsProvider({ children }: { children: React.ReactNode }) {
  const [running, setRunning] = useState<RunningJob | null>(null);
  const [queue, setQueue] = useState<QueuedJob[]>([]);
  const [history, setHistory] = useState<FinishedJob[]>([]);
  const [progress, setProgress] = useState<JobProgress | null>(null);

  // Catena di esecuzione: ogni run() si aggancia alla precedente, così i job
  // partono in ordine e non si sovrappongono mai sul main.
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const cancelledIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    const off = window.crateforge.jobs.onProgress((p) => {
      setProgress({ phase: p.phase, done: p.done, total: p.total });
    });
    return off;
  }, []);

  useEffect(() => {
    setRunning((r) => (r ? { ...r, progress } : r));
  }, [progress]);

  const percent = useMemo(() => {
    if (!progress || progress.total <= 0) return null;
    return Math.min(100, Math.round((progress.done / progress.total) * 100));
  }, [progress]);

  const etaS = useMemo(() => {
    if (!running || !progress || progress.total <= 0 || progress.done <= 0) return null;
    const elapsed = (Date.now() - running.startedAt) / 1000;
    if (elapsed < 2) return null;
    const rate = progress.done / elapsed;
    if (rate <= 0) return null;
    return Math.round((progress.total - progress.done) / rate);
  }, [running, progress]);

  const cancel = useCallback(() => {
    if (running) cancelledIds.current.add(running.id);
    // Le operazioni ancora in coda non devono partire dopo un annullamento.
    setQueue((q) => {
      q.forEach((j) => cancelledIds.current.add(j.id));
      return [];
    });
    window.crateforge.jobs.cancel();
  }, [running]);

  const run = useCallback<JobsApi['run']>((label, fn, opts) => {
    const id = nextId();
    setQueue((q) => [...q, { id, label }]);

    const task = chain.current.then(async () => {
      if (cancelledIds.current.has(id)) {
        cancelledIds.current.delete(id);
        setQueue((q) => q.filter((j) => j.id !== id));
        throw new Error('cancelled');
      }
      setQueue((q) => q.filter((j) => j.id !== id));
      const startedAt = Date.now();
      setProgress(null);
      setRunning({ id, label, startedAt, progress: null, cancellable: opts?.cancellable !== false });
      try {
        const result = await fn();
        const cancelled = cancelledIds.current.delete(id);
        setHistory((h) =>
          [
            {
              id,
              label,
              outcome: cancelled ? ('cancelled' as JobOutcome) : ('done' as JobOutcome),
              at: Date.now(),
              durationS: (Date.now() - startedAt) / 1000,
              detail: opts?.detail?.(result)
            },
            ...h
          ].slice(0, 50)
        );
        return result;
      } catch (err) {
        cancelledIds.current.delete(id);
        setHistory((h) =>
          [
            {
              id,
              label,
              outcome: 'failed' as JobOutcome,
              at: Date.now(),
              durationS: (Date.now() - startedAt) / 1000,
              detail: String(err)
            },
            ...h
          ].slice(0, 50)
        );
        throw err;
      } finally {
        setRunning((r) => (r?.id === id ? null : r));
        setProgress(null);
      }
    });

    // La catena non deve mai restare "rejected", altrimenti il job successivo
    // non partirebbe più.
    chain.current = task.catch(() => undefined);
    return task as Promise<never>;
  }, []);

  const value = useMemo<JobsApi>(
    () => ({
      running,
      queue,
      history,
      percent,
      etaS,
      cancel,
      run,
      busy: running !== null || queue.length > 0
    }),
    [running, queue, history, percent, etaS, cancel, run]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useJobs(): JobsApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('useJobs fuori dal provider');
  return v;
}
