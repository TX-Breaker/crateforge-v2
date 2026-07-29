import { execFile, execFileSync } from 'child_process';
import { existsSync } from 'fs';
import { app } from 'electron';
import { join } from 'path';

/**
 * Rilevamento autonomo dell'interprete Python.
 *
 * Quando serve DAVVERO: nell'app distribuita il sidecar è un binario
 * PyInstaller, quindi Python NON serve affatto e questo modulo risponde
 * `required: false`. Serve solo quando si gira dai sorgenti (sviluppo, o un
 * pacchetto in cui il binario non è stato costruito): lì il sidecar è uno
 * script `.py` e qualcuno deve eseguirlo.
 *
 * Perché non basta lanciare "python": su Windows il comando `python` è spesso
 * lo STUB del Microsoft Store, che non esegue nulla e apre il negozio; e anche
 * un Python vero di sistema non ha le dipendenze del sidecar (mutagen,
 * pyrekordbox), che vivono nel virtualenv del progetto. Cerchiamo quindi, in
 * ordine: il venv del progetto, il launcher `py -3`, poi il PATH — e ogni
 * candidato viene VERIFICATO eseguendolo, non solo guardando se il file c'è.
 */

export type PythonSource = 'venv' | 'launcher' | 'path';

export interface PythonInfo {
  /** false quando il sidecar impacchettato rende Python del tutto superfluo. */
  required: boolean;
  found: boolean;
  /** Percorso reale dell'eseguibile (sys.executable), non l'alias invocato. */
  path: string | null;
  version: string | null;
  source: PythonSource | null;
  /** true se l'interprete trovato ha le dipendenze del sidecar. */
  hasSidecarDeps: boolean;
  /** Comandi provati, per poterli mostrare in chiaro nella diagnostica. */
  checked: string[];
}

/** Versione minima: sotto questa il sidecar non è testato. */
const MIN_MAJOR = 3;
const MIN_MINOR = 9;

/** Moduli senza i quali il sidecar non può fare il suo lavoro. */
const REQUIRED_MODULES = ['mutagen'];

/**
 * Radice dell'app. Letta in modo difensivo perché questo modulo gira anche
 * fuori da Electron (test unitari eseguiti con ELECTRON_RUN_AS_NODE, dove
 * `app` non esiste): lì la radice è la cartella di lavoro.
 */
function appRoot(): string {
  try {
    return app?.getAppPath?.() ?? process.cwd();
  } catch {
    return process.cwd();
  }
}

function isPackaged(): boolean {
  try {
    return app?.isPackaged === true;
  } catch {
    return false;
  }
}

export function sidecarDir(): string {
  return join(appRoot(), 'python-sidecar');
}

/** Percorso atteso del Python del virtualenv del progetto (può non esistere). */
export function venvPython(): string {
  return process.platform === 'win32'
    ? join(sidecarDir(), '.venv', 'Scripts', 'python.exe')
    : join(sidecarDir(), '.venv', 'bin', 'python');
}

interface Probe {
  path: string;
  version: string;
  hasDeps: boolean;
}

/**
 * Interroga un candidato eseguendolo. Ritorna null se non è un Python usabile:
 * copre in un colpo solo l'eseguibile inesistente, lo stub del Microsoft Store
 * (che non stampa nulla) e le versioni troppo vecchie.
 */
function probe(cmd: string, args: string[] = []): Probe | null {
  const script =
    'import sys\n' +
    'print(sys.executable)\n' +
    'print("%d.%d.%d" % sys.version_info[:3])\n' +
    'mods = []\n' +
    'import importlib.util\n' +
    'for m in ' +
    JSON.stringify(REQUIRED_MODULES) +
    ':\n'
    + '    mods.append("1" if importlib.util.find_spec(m) else "0")\n' +
    'print("".join(mods))\n';
  let out: string;
  try {
    out = execFileSync(cmd, [...args, '-c', script], {
      encoding: 'utf-8',
      timeout: 8000,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore']
    });
  } catch {
    return null;
  }
  const lines = out.trim().split(/\r?\n/);
  if (lines.length < 3) return null;
  const [exePath, version, mods] = lines;
  const m = version.match(/^(\d+)\.(\d+)\./);
  if (!m) return null;
  const major = Number(m[1]);
  const minor = Number(m[2]);
  if (major < MIN_MAJOR || (major === MIN_MAJOR && minor < MIN_MINOR)) return null;
  return { path: exePath, version, hasDeps: !mods.includes('0') };
}

let cached: PythonInfo | null = null;

/**
 * Rileva l'interprete migliore disponibile. Il risultato è memorizzato per la
 * durata del processo (ogni sonda costa uno spawn); `force` lo rilegge dopo
 * un'installazione.
 */
export function detectPython(force = false): PythonInfo {
  if (cached && !force) return cached;

  // Sidecar impacchettato: Python non serve, e non ha senso frugare nel PATH.
  const packagedBinary = join(
    process.resourcesPath ?? '',
    'sidecar',
    process.platform === 'win32' ? 'crateforge-sidecar.exe' : 'crateforge-sidecar'
  );
  if (isPackaged() && existsSync(packagedBinary)) {
    cached = {
      required: false,
      found: false,
      path: null,
      version: null,
      source: null,
      hasSidecarDeps: false,
      checked: []
    };
    return cached;
  }

  const checked: string[] = [];
  const candidates: { cmd: string; args: string[]; source: PythonSource }[] = [];

  // 1) Il venv del progetto: è l'unico che ha di sicuro le dipendenze.
  const venv = venvPython();
  if (existsSync(venv)) candidates.push({ cmd: venv, args: [], source: 'venv' });

  // 2) Il launcher di Windows: sa dov'è Python anche quando il PATH non lo sa,
  //    e non è mai lo stub del Microsoft Store.
  if (process.platform === 'win32') candidates.push({ cmd: 'py', args: ['-3'], source: 'launcher' });

  // 3) Il PATH, per ultimo.
  for (const cmd of process.platform === 'win32' ? ['python', 'python3'] : ['python3', 'python']) {
    candidates.push({ cmd, args: [], source: 'path' });
  }

  let best: (Probe & { source: PythonSource }) | null = null;
  for (const c of candidates) {
    checked.push([c.cmd, ...c.args].join(' '));
    const p = probe(c.cmd, c.args);
    if (!p) continue;
    // Con le dipendenze si smette di cercare: è quello giusto. Senza, si tiene
    // come ripiego ma si continua, magari più avanti c'è un ambiente completo.
    if (p.hasDeps) {
      best = { ...p, source: c.source };
      break;
    }
    if (!best) best = { ...p, source: c.source };
  }

  cached = {
    required: true,
    found: best !== null,
    path: best?.path ?? null,
    version: best?.version ?? null,
    source: best?.source ?? null,
    hasSidecarDeps: best?.hasDeps ?? false,
    checked
  };
  return cached;
}

/**
 * Comando con cui eseguire lo script del sidecar, o null se su questo computer
 * non c'è un Python utilizzabile. Preferisce sempre il venv del progetto:
 * lanciare lo script con un Python di sistema privo di mutagen fallirebbe a
 * metà lavoro, che è il momento peggiore per accorgersene.
 */
export function pythonExecutable(): string | null {
  const info = detectPython();
  return info.path;
}

export interface EnsureEnvResult {
  ok: boolean;
  created: boolean;
  message: string;
}

function run(cmd: string, args: string[], timeoutMs: number): Promise<{ code: number; err: string }> {
  return new Promise((resolve) => {
    execFile(
      cmd,
      args,
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 8 * 1024 * 1024, cwd: sidecarDir() },
      (error, _stdout, stderr) => {
        const code = error && typeof (error as { code?: number }).code === 'number'
          ? (error as { code: number }).code
          : error
            ? 1
            : 0;
        resolve({ code, err: (stderr || String(error ?? '')).slice(-2000) });
      }
    );
  });
}

/**
 * Prepara da sola l'ambiente del sidecar: crea il virtualenv e installa le
 * dipendenze pinnate. Serve a togliere di mezzo il setup manuale su una
 * macchina di sviluppo appena clonata.
 *
 * Non viene mai eseguita sull'app impacchettata (lì c'è il binario) e non fa
 * nulla se l'ambiente è già a posto: è idempotente e sicura da richiamare.
 */
export async function ensureSidecarEnv(): Promise<EnsureEnvResult> {
  const info = detectPython(true);
  if (!info.required) {
    return { ok: true, created: false, message: 'Sidecar impacchettato: Python non serve.' };
  }
  if (info.found && info.hasSidecarDeps) {
    return { ok: true, created: false, message: `Ambiente già pronto (${info.path}).` };
  }
  if (!info.found) {
    return {
      ok: false,
      created: false,
      message:
        'Nessun Python 3.9+ trovato su questo computer. Installa Python da python.org ' +
        `(comandi provati: ${info.checked.join(', ')}) e riprova.`
    };
  }

  const requirements = join(sidecarDir(), 'requirements.txt');
  if (!existsSync(requirements)) {
    return { ok: false, created: false, message: `requirements.txt non trovato in ${sidecarDir()}.` };
  }

  // Il venv va creato con il Python di sistema, non con quello del venv stesso.
  const venv = venvPython();
  let created = false;
  if (!existsSync(venv)) {
    const r = await run(info.path!, ['-m', 'venv', join(sidecarDir(), '.venv')], 300_000);
    if (r.code !== 0 || !existsSync(venv)) {
      return { ok: false, created: false, message: `Creazione del virtualenv fallita: ${r.err}` };
    }
    created = true;
  }

  // --prefer-binary: wheel prebuilt dove esistono, così non serve un compilatore C.
  const install = await run(
    venv,
    ['-m', 'pip', 'install', '--prefer-binary', '-r', requirements],
    900_000
  );
  const after = detectPython(true);
  if (install.code !== 0 || !after.hasSidecarDeps) {
    return {
      ok: false,
      created,
      message: `Installazione delle dipendenze del sidecar non riuscita: ${install.err}`
    };
  }
  return {
    ok: true,
    created,
    message: `Ambiente del sidecar pronto (${after.path}).`
  };
}
