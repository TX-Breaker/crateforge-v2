import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

/**
 * Stato "vivo" della libreria, condiviso da sidebar, statusbar, panoramica e
 * diagnosi. Una sola fonte per i contatori che compaiono in più punti della
 * shell: se la barra laterale dice 12.481 tracce, la panoramica non può dire
 * un numero diverso.
 */

export interface LibraryStats {
  tracks: number;
  playlists: number;
  needsReview: number;
  lastIngest?: { source: string; finished_at: string | null; status: string } | null;
}

export interface HealthReport {
  total: number;
  missingBpm: number;
  missingKey: number;
  missingGenre: number;
  missingYear: number;
  needsReview: number;
  withoutHotCues: number;
  duplicateGroups: number;
  duplicateTracks: number;
  fingerprinted: number;
  score: number;
}

export interface PreflightState {
  checkedAt: string;
  sidecar: { available: boolean; runs: boolean; binaryPath?: string; reason?: string };
  key: { ready: boolean; downloaded: boolean; message?: string };
  os: { platform: string; release: string; changed: boolean };
  ok: boolean;
}

export interface RekordboxPaths {
  dir: string;
  masterDb: string;
  masterDbExists: boolean;
  optionsJson: string;
  optionsJsonExists: boolean;
}

interface WatcherStatus {
  running: boolean;
  folder: string | null;
  pending?: number;
}

interface LibraryApi {
  stats: LibraryStats | null;
  health: HealthReport | null;
  preflight: PreflightState | null;
  sidecar: { available: boolean; binaryPath?: string } | null;
  rbPaths: RekordboxPaths | null;
  watcher: WatcherStatus;
  arrivals: number;
  loading: boolean;
  /** ricarica statistiche + diagnosi (dopo un import, una pulizia, ecc.) */
  refresh: () => Promise<void>;
  refreshArrivals: () => Promise<void>;
  rerunPreflight: () => Promise<void>;
  /** true quando il modulo di lettura diretta non è disponibile */
  xmlOnly: boolean;
  /** true finché nessuna libreria è stata importata */
  empty: boolean;
}

const Ctx = createContext<LibraryApi | null>(null);

export function LibraryProvider({ children }: { children: React.ReactNode }) {
  const [stats, setStats] = useState<LibraryStats | null>(null);
  const [health, setHealth] = useState<HealthReport | null>(null);
  const [preflight, setPreflight] = useState<PreflightState | null>(null);
  const [sidecar, setSidecar] = useState<{ available: boolean; binaryPath?: string } | null>(null);
  const [rbPaths, setRbPaths] = useState<RekordboxPaths | null>(null);
  const [watcher, setWatcher] = useState<WatcherStatus>({ running: false, folder: null });
  const [arrivals, setArrivals] = useState(0);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const [s, h] = await Promise.all([
      window.crateforge.library.stats(),
      window.crateforge.health.get()
    ]);
    setStats(s as LibraryStats);
    setHealth(h as HealthReport);
    setLoading(false);
  }, []);

  const refreshArrivals = useCallback(async () => {
    try {
      const items = (await window.crateforge.inbox.list('new')) as unknown[];
      setArrivals(Array.isArray(items) ? items.length : 0);
      const st = (await window.crateforge.watcher.status()) as WatcherStatus;
      if (st) setWatcher({ running: !!st.running, folder: st.folder ?? null });
    } catch {
      // La coda "nuovi acquisti" è una funzione Esperto: se non è disponibile
      // non è un errore, semplicemente non c'è nulla da contare.
      setArrivals(0);
    }
  }, []);

  useEffect(() => {
    refresh();
    refreshArrivals();
    window.crateforge.sidecar.check().then(setSidecar);
    window.crateforge.rekordbox.defaultPaths().then(setRbPaths);
    window.crateforge.preflight.get().then((s) => setPreflight((s as PreflightState) ?? null));
    const offPreflight = window.crateforge.preflight.onUpdate((s) =>
      setPreflight(s as PreflightState)
    );
    const offInbox = window.crateforge.watcher.onNewItems(() => {
      refreshArrivals();
    });
    return () => {
      offPreflight();
      offInbox();
    };
  }, [refresh, refreshArrivals]);

  const rerunPreflight = useCallback(async () => {
    setPreflight((await window.crateforge.preflight.rerun()) as PreflightState);
    setSidecar(await window.crateforge.sidecar.check());
  }, []);

  const value = useMemo<LibraryApi>(
    () => ({
      stats,
      health,
      preflight,
      sidecar,
      rbPaths,
      watcher,
      arrivals,
      loading,
      refresh,
      refreshArrivals,
      rerunPreflight,
      xmlOnly: sidecar !== null && !sidecar.available,
      empty: (stats?.tracks ?? 0) === 0
    }),
    [
      stats,
      health,
      preflight,
      sidecar,
      rbPaths,
      watcher,
      arrivals,
      loading,
      refresh,
      refreshArrivals,
      rerunPreflight
    ]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLibrary(): LibraryApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('useLibrary fuori dal provider');
  return v;
}
