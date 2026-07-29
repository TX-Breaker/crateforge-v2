import { release, platform } from 'os';
import type BetterSqlite3 from 'better-sqlite3';
import { getSetting, logOperation, setSetting } from '@core/udm';
import { checkSidecar, runSidecar, SidecarEvent } from './sidecar';
import { detectPython, ensureSidecarEnv } from './pythonRuntime';

/**
 * Preflight all'avvio (§ auto-setup): verifica che tutto sia pronto su un
 * computer appena installato — e lo ripara dove può, senza intervento utente.
 *
 *  1) il sidecar è presente ED effettivamente eseguibile (un `ping`: intercetta
 *     anche le rotture da AGGIORNAMENTO OS, quando il binario PyInstaller non
 *     parte più / va ri-autorizzato);
 *  2) la chiave di lettura del master.db è in cache; se manca la scarica
 *     (Rekordbox >= 6.6.5), così "Leggi master.db direttamente" funziona subito.
 *
 * Viene rieseguito a ogni avvio (costa un ping): se un upgrade di macOS ha
 * rotto qualcosa o svuotato la cache, al riavvio si rileva e, per la chiave, si
 * ri-sistema da solo.
 */

export interface PreflightState {
  checkedAt: string;
  sidecar: { available: boolean; runs: boolean; binaryPath?: string; reason?: string };
  /**
   * Stato dell'interprete Python. `required: false` sull'app distribuita, dove
   * il sidecar è un binario e Python non serve: dirlo esplicitamente evita la
   * domanda più frequente ("devo installare Python?").
   */
  python: {
    required: boolean;
    found: boolean;
    path?: string;
    version?: string;
    depsReady: boolean;
    /** true mentre l'ambiente si sta preparando da solo in background. */
    installing?: boolean;
    message?: string;
  };
  key: { ready: boolean; downloaded: boolean; message?: string };
  os: { platform: string; release: string; changed: boolean };
  ok: boolean;
}

let lastState: PreflightState | null = null;
export function getLastPreflight(): PreflightState | null {
  return lastState;
}

/** Esegue un comando sidecar raccogliendone done/error, con timeout+cancel. */
function runSidecarCollect(
  command: string,
  udmPath: string,
  args: string[],
  timeoutMs: number
): Promise<{ code: number | null; done?: Record<string, unknown>; error?: string }> {
  return new Promise((resolve) => {
    let done: Record<string, unknown> | undefined;
    let error: string | undefined;
    let settled = false;
    const handle = runSidecar({
      command,
      udmPath,
      args,
      onEvent: (ev: SidecarEvent) => {
        if (ev.type === 'done') done = ev.data;
        else if (ev.type === 'error') error = ev.message;
      }
    });
    const timer = setTimeout(() => {
      if (!settled) {
        error = error ?? `timeout dopo ${Math.round(timeoutMs / 1000)}s`;
        try {
          handle.cancel();
        } catch {
          /* best-effort */
        }
      }
    }, timeoutMs);
    handle.finished.then(({ code }) => {
      settled = true;
      clearTimeout(timer);
      resolve({ code, done, error });
    });
  });
}

/**
 * Una sola riparazione per sessione: se l'installazione delle dipendenze non
 * riesce, riprovare a ogni riavvio significherebbe scaricare pacchetti in
 * loop senza che nulla cambi.
 */
let envRepairAttempted = false;

export async function runPreflight(
  db: BetterSqlite3.Database,
  udmPath: string,
  /** Notifica il renderer quando la riparazione in background è finita. */
  notify?: (state: PreflightState) => void
): Promise<PreflightState> {
  const osPlatform = platform();
  const osRelease = release();
  const lastOs = getSetting(db, 'lastOsRelease');
  const osChanged = lastOs !== null && lastOs !== osRelease;

  const chk = checkSidecar();
  let sidecarRuns = false;
  const key: PreflightState['key'] = { ready: false, downloaded: false };

  if (chk.available) {
    // 1) Il binario parte davvero? (canary per rotture post-upgrade OS.)
    const ping = await runSidecarCollect('ping', udmPath, [], 15000);
    sidecarRuns = ping.code === 0 && ping.done?.pong === true;

    if (sidecarRuns) {
      // 2) Chiave pronta? Scaricala se manca (esce sempre 0: stato in data).
      const ek = await runSidecarCollect('ensure-key', udmPath, [], 45000);
      if (ek.code === 0 && ek.done) {
        key.ready = ek.done.keyReady === true;
        key.downloaded = ek.done.downloaded === true;
        if (typeof ek.done.error === 'string') key.message = ek.done.error;
      } else {
        key.message = ek.error ?? `il controllo chiave è terminato con codice ${ek.code}`;
      }
    }
  }

  // Ricorda l'OS per rilevare gli upgrade al prossimo avvio.
  setSetting(db, 'lastOsRelease', osRelease);

  const py = detectPython();
  const state: PreflightState = {
    checkedAt: new Date().toISOString(),
    sidecar: {
      available: chk.available,
      runs: sidecarRuns,
      binaryPath: chk.available ? chk.binaryPath : undefined,
      reason: chk.available ? undefined : chk.reason
    },
    python: {
      required: py.required,
      found: py.found,
      path: py.path ?? undefined,
      version: py.version ?? undefined,
      depsReady: !py.required || py.hasSidecarDeps
    },
    key,
    os: { platform: osPlatform, release: osRelease, changed: osChanged },
    ok: chk.available && sidecarRuns && key.ready
  };
  lastState = state;

  /* Auto-setup dell'ambiente Python (§ auto-setup): se il sidecar non è
     eseguibile solo perché il virtualenv non è mai stato creato, lo prepariamo
     da soli invece di chiedere all'utente di aprire un terminale. Va in
     background — l'installazione dei pacchetti dura minuti e bloccare l'avvio
     sarebbe peggio del problema — e al termine il preflight viene rieseguito e
     il renderer aggiornato. Mai sull'app impacchettata: lì c'è il binario. */
  const needsEnv = py.required && (!py.found || !py.hasSidecarDeps);
  if (needsEnv && !envRepairAttempted && getSetting(db, 'pythonAutoSetup') !== '0') {
    envRepairAttempted = true;
    state.python.installing = true;
    void ensureSidecarEnv()
      .then(async (r) => {
        logOperation(db, 'preflight.python-setup', null, r.ok ? 'ok' : 'error', r.message);
        const fresh = await runPreflight(db, udmPath, notify);
        fresh.python.message = r.message;
        lastState = fresh;
        notify?.(fresh);
      })
      .catch((err) => {
        logOperation(db, 'preflight.python-setup', null, 'error', String(err));
      });
  }

  // Log a basso rumore: solo se c'è qualcosa da sapere (problema, OS cambiato,
  // o chiave appena scaricata). Un avvio "tutto ok" non sporca il registro.
  if (!state.ok || osChanged || key.downloaded) {
    const sc = state.sidecar.runs ? 'ok' : chk.available ? 'non-avviabile' : 'assente';
    logOperation(
      db,
      'preflight',
      null,
      state.ok ? 'ok' : sidecarRuns ? 'skipped' : 'error',
      `sidecar=${sc} chiave=${key.ready ? 'pronta' : 'assente'}` +
        `${key.downloaded ? ' (scaricata)' : ''}${osChanged ? ' os-aggiornato' : ''}` +
        `${key.message ? ` — ${key.message}` : ''}`
    );
  }
  return state;
}
