import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { app } from 'electron';
import { join } from 'path';
import { createInterface } from 'readline';

const IS_WIN = process.platform === 'win32';

/**
 * Gestione del sidecar Python (pyrekordbox + fpcalc).
 *
 * Handshake UDM (§2): Node decide il percorso dell'UDM e lo passa allo spawn
 * come argomento CLI --udm-path. Python apre il file già migrato e scrive
 * SOLO nelle tabelle di ingestion. Node non apre mai il master.db cifrato.
 *
 * IPC col sidecar: SOLO comandi e stati di avanzamento via stdout (JSON per
 * riga). Mai bulk data: i dati di massa Python li scrive direttamente nell'UDM.
 */

export interface SidecarEvent {
  type: 'progress' | 'done' | 'error' | 'log';
  phase?: string;
  done?: number;
  total?: number;
  message?: string;
  data?: Record<string, unknown>;
}

export type SidecarAvailability =
  | { available: true; binaryPath: string }
  | { available: false; reason: 'not-found' | 'not-built'; searched: string[] };

const BINARY_NAME = process.platform === 'win32' ? 'crateforge-sidecar.exe' : 'crateforge-sidecar';

/**
 * Verifica presenza del binario PRIMA di ogni operazione che lo richiede (§8).
 * Se manca: tipico falso positivo antivirus su binari PyInstaller (Windows
 * Defender li mette in quarantena). La UI mostra istruzioni, non un crash.
 */
export function checkSidecar(): SidecarAvailability {
  const searched: string[] = [];

  if (app.isPackaged) {
    const packaged = join(process.resourcesPath, 'sidecar', BINARY_NAME);
    searched.push(packaged);
    if (existsSync(packaged)) return { available: true, binaryPath: packaged };
    return { available: false, reason: 'not-found', searched };
  }

  // Sviluppo: dist PyInstaller --onedir, poi fallback allo script via python
  const devBinary = join(app.getAppPath(), 'python-sidecar', 'dist', 'crateforge-sidecar', BINARY_NAME);
  searched.push(devBinary);
  if (existsSync(devBinary)) return { available: true, binaryPath: devBinary };

  const devScript = join(app.getAppPath(), 'python-sidecar', 'sidecar.py');
  searched.push(devScript);
  if (existsSync(devScript)) return { available: true, binaryPath: devScript };

  return { available: false, reason: 'not-built', searched };
}

export interface SidecarRunOptions {
  command: string; // es. 'ingest-masterdb'
  udmPath: string;
  args?: string[];
  onEvent: (ev: SidecarEvent) => void;
}

export interface SidecarHandle {
  cancel: () => void;
  finished: Promise<{ code: number | null }>;
}

export function runSidecar(opts: SidecarRunOptions): SidecarHandle {
  const check = checkSidecar();
  if (!check.available) {
    opts.onEvent({
      type: 'error',
      message:
        'Sidecar Python non trovato. Se usi Windows, l\'antivirus potrebbe averlo messo in quarantena: ' +
        'controlla le notifiche di Windows Defender e ripristina/escludi la cartella dell\'app. ' +
        `Percorsi cercati: ${check.searched.join(' ; ')}`
    });
    return { cancel: () => undefined, finished: Promise.resolve({ code: -1 }) };
  }

  const isScript = check.binaryPath.endsWith('.py');
  const cmd = isScript ? pythonExecutable() : check.binaryPath;
  const baseArgs = isScript ? [check.binaryPath] : [];
  const args = [
    ...baseArgs,
    opts.command,
    '--udm-path',
    opts.udmPath,
    ...(opts.args ?? [])
  ];

  const child = spawn(cmd, args, {
    cwd: join(check.binaryPath, '..'),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    // POSIX: il figlio diventa capo del proprio process group così cancel()
    // può uccidere l'INTERO albero (fpcalc/demucs figli), non solo il padre.
    detached: !IS_WIN
  });

  // Se il sidecar ha già emesso un errore strutturato (fail()), NON sovrascriverlo
  // col generico "terminato con codice N": quel messaggio specifico è quello utile
  // all'utente. Il generico resta come fallback solo per crash silenziosi
  // (segfault, errore su stderr, exit non-zero senza evento error).
  let sawError = false;
  const rl = createInterface({ input: child.stdout });
  rl.on('line', (line) => {
    if (!line.trim()) return;
    // Parse e dispatch separati: se onEvent lancia, non deve essere scambiato
    // per un errore di parse e ri-emesso come log (doppio processamento).
    let ev: unknown;
    try {
      ev = JSON.parse(line);
    } catch {
      opts.onEvent({ type: 'log', message: line });
      return;
    }
    if (ev && typeof ev === 'object' && typeof (ev as SidecarEvent).type === 'string') {
      if ((ev as SidecarEvent).type === 'error') sawError = true;
      opts.onEvent(ev as SidecarEvent);
    } else {
      opts.onEvent({ type: 'log', message: line });
    }
  });

  let stderrTail = '';
  child.stderr.on('data', (chunk: Buffer) => {
    stderrTail = (stderrTail + chunk.toString('utf-8')).slice(-4000);
  });

  const finished = new Promise<{ code: number | null }>((resolve) => {
    child.on('close', (code) => {
      if (code !== 0 && code !== null && !sawError) {
        opts.onEvent({
          type: 'error',
          message: `Il sidecar è terminato con codice ${code}. ${stderrTail ? 'Dettagli: ' + stderrTail : ''}`
        });
      }
      resolve({ code });
    });
    child.on('error', (err) => {
      opts.onEvent({ type: 'error', message: `Impossibile avviare il sidecar: ${err.message}` });
      resolve({ code: -1 });
    });
  });

  return {
    // Annulla uccidendo l'intero albero di processi, con escalation.
    cancel: () => {
      const pid = child.pid;
      if (pid === undefined) return;
      if (IS_WIN) {
        // taskkill /T uccide anche i figli (fpcalc/demucs).
        spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true });
      } else {
        try {
          process.kill(-pid, 'SIGTERM'); // -pid = tutto il process group
        } catch {
          child.kill('SIGTERM');
        }
        // Escalation a SIGKILL se dopo 3s non è morto.
        setTimeout(() => {
          try {
            process.kill(-pid, 'SIGKILL');
          } catch {
            /* già morto */
          }
        }, 3000);
      }
    },
    finished
  };
}

function pythonExecutable(): string {
  // Solo per sviluppo (script non impacchettato); in produzione si usa il binario PyInstaller.
  return process.platform === 'win32' ? 'python' : 'python3';
}
