import { execFile } from 'child_process';
import { promisify } from 'util';
import type { DjSoftware } from '@core/djVersions';

const exec = promisify(execFile);

/**
 * Rilevamento del software DJ in esecuzione, da interrogare PRIMA di ogni
 * scrittura verso la sua libreria.
 *
 * Perché non basta il gate delle versioni. Il gate risponde a «conosco questo
 * formato?»; questo modulo risponde a «c'è qualcuno che sta usando quel file
 * proprio adesso?». Sono due domande diverse e servono entrambe.
 *
 * ⚠ Il caso peggiore non è l'errore, è il silenzio. Traktor tiene la collezione
 * in memoria e la riscrive per intero alla chiusura: una modifica fatta a
 * `collection.nml` mentre Traktor è aperto non fallisce, viene semplicemente
 * cancellata quando l'utente chiude il programma. Nessun errore, nessun
 * avviso, e l'utente scopre giorni dopo che il lavoro non c'è più. Su un
 * database SQLite aperto in esclusiva (Rekordbox, Engine, Serato 4) il danno è
 * più immediato ma almeno rumoroso.
 *
 * Il rilevamento è per NOME DI PROCESSO, che è un'euristica: un eseguibile
 * rinominato sfugge, un processo omonimo di un altro programma dà un falso
 * positivo. Un falso positivo costa un'operazione rimandata; un falso negativo
 * costa la libreria dell'utente. La progettazione pende deliberatamente dalla
 * parte del falso positivo — vedi `assertNotRunning`.
 */

export interface ProcessPattern {
  /** Nomi eseguibile su Windows, confrontati senza distinzione di maiuscole. */
  win: string[];
  /** Espressioni sul nome del comando su macOS e Linux. */
  unix: RegExp[];
  /** true quando il pattern viene dalla specifica, false quando è dedotto. */
  verified: boolean;
}

/**
 * ⚠ Solo Serato e VirtualDJ hanno pattern presi dalla specifica dei formati.
 * Gli altri tre sono **assunzioni** ricavate dai nomi di installazione più
 * comuni e vanno confermate su una macchina con quel software installato:
 * finché `verified` è false, un mancato rilevamento è previsto, non sorprendente.
 */
export const PROCESS_PATTERNS: Record<DjSoftware, ProcessPattern> = {
  // Specifica: /serato dj (pro|lite)( v\d+)?\.exe/i
  serato: {
    win: [],
    unix: [/^serato\s?dj/i],
    verified: true
  },
  /* Serato 4 e Serato <=3 sono due FORMATI diversi ma UN SOLO programma: il
     processo da cercare e' lo stesso. Tenerli separati nel registro serve al
     gate delle versioni, non al rilevamento. */
  serato4: {
    win: [],
    unix: [/^serato\s?dj/i],
    verified: true
  },
  // Specifica: ["virtualdj8.exe", "virtualdj.exe"] su Windows, /^virtualdj/i su macOS
  virtualdj: {
    win: ['virtualdj8.exe', 'virtualdj.exe'],
    unix: [/^virtualdj/i],
    verified: true
  },
  // ASSUNZIONE: nome dell'eseguibile non documentato nella specifica.
  rekordbox: {
    win: ['rekordbox.exe'],
    unix: [/^rekordbox/i],
    verified: false
  },
  // ASSUNZIONE: idem.
  traktor: {
    win: ['traktor.exe', 'traktor pro 3.exe', 'traktor pro 4.exe'],
    unix: [/^traktor/i],
    verified: false
  },
  // ASSUNZIONE: idem.
  engine: {
    win: ['engine dj.exe', 'enginedj.exe', 'engine_dj.exe'],
    unix: [/^engine\s?dj/i],
    verified: false
  }
};

/** Espressione regolare della specifica per gli eseguibili Serato su Windows. */
const SERATO_WIN_RE = /^serato dj (pro|lite)( v\d+)?\.exe$/i;

export interface RunningVerdict {
  software: DjSoftware;
  running: boolean;
  /** Nome del processo che ha fatto scattare il rilevamento. */
  matched: string | null;
  /**
   * true quando l'elenco dei processi non è stato ottenuto. Non è un "no":
   * è un "non lo so", e va trattato come tale.
   */
  unknown: boolean;
  /** false quando il pattern è un'assunzione e non viene dalla specifica. */
  verified: boolean;
}

/**
 * Debounce della specifica: 500 ms. Chiedere l'elenco dei processi costa una
 * cinquantina di millisecondi, e una schermata che valuta cinque software in
 * fila lo chiederebbe cinque volte per niente.
 */
const DEBOUNCE_MS = 500;

let cache: { at: number; names: string[] } | null = null;
let inflight: Promise<string[]> | null = null;

/** Azzera la cache. Serve ai test, e dopo che l'utente dichiara di aver chiuso. */
export function resetProcessCache(): void {
  cache = null;
  inflight = null;
}

/**
 * Elenco dei processi in esecuzione, in minuscolo.
 *
 * Lancia se non riesce a ottenerlo: distinguere "nessun processo" da "non l'ho
 * potuto chiedere" è tutto il punto di questo modulo, e un array vuoto
 * confonderebbe i due casi.
 */
async function listProcesses(): Promise<string[]> {
  const now = Date.now();
  if (cache && now - cache.at < DEBOUNCE_MS) return cache.names;
  if (inflight) return inflight;

  inflight = (async () => {
    let names: string[];
    if (process.platform === 'win32') {
      /* `tasklist /fo csv /nh` produce righe "nome.exe","pid",… — si prende il
         primo campo. `/fo csv` invece del formato tabellare perché quest'ultimo
         tronca i nomi lunghi a 25 caratteri, ed è esattamente il caso di
         "Serato DJ Pro.exe" con un suffisso di versione. */
      const { stdout } = await exec('tasklist', ['/fo', 'csv', '/nh'], {
        windowsHide: true,
        maxBuffer: 8 * 1024 * 1024
      });
      names = stdout
        .split(/\r?\n/)
        .map((line) => /^"([^"]*)"/.exec(line)?.[1] ?? '')
        .filter(Boolean)
        .map((n) => n.toLowerCase());
    } else {
      const { stdout } = await exec('ps', ['-A', '-o', 'comm='], {
        maxBuffer: 8 * 1024 * 1024
      });
      names = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        // `ps -o comm=` dà il percorso completo su macOS: interessa il basename.
        .map((n) => (n.split('/').pop() ?? n).toLowerCase());
    }
    cache = { at: Date.now(), names };
    inflight = null;
    return names;
  })();

  try {
    return await inflight;
  } catch (err) {
    inflight = null;
    throw err;
  }
}

/** Il software è in esecuzione? Non lancia mai: l'incertezza è nel verdetto. */
export async function isDjSoftwareRunning(software: DjSoftware): Promise<RunningVerdict> {
  const pattern = PROCESS_PATTERNS[software];
  const base: RunningVerdict = {
    software,
    running: false,
    matched: null,
    unknown: false,
    verified: pattern.verified
  };

  let names: string[];
  try {
    names = await listProcesses();
  } catch {
    return { ...base, unknown: true };
  }

  const matched = names.find((name) => {
    if (process.platform === 'win32') {
      if ((software === 'serato' || software === 'serato4') && SERATO_WIN_RE.test(name)) return true;
      return pattern.win.includes(name);
    }
    return pattern.unix.some((re) => re.test(name));
  });

  return { ...base, running: matched !== undefined, matched: matched ?? null };
}

/**
 * Guardia da mettere prima di ogni scrittura verso la libreria di `software`.
 *
 * ⚠ Solleva anche quando l'elenco dei processi non è ottenibile. È la scelta
 * scomoda: su una macchina dove `tasklist` non risponde nessuna scrittura verso
 * librerie di terze parti parte più. Ma l'alternativa — trattare "non lo so"
 * come "non è in esecuzione" — significa che il primo ambiente inatteso
 * disattiva silenziosamente l'unica protezione contro la corruzione. Il
 * messaggio dice esplicitamente perché si è fermato, così l'utente può chiudere
 * il programma e riprovare invece di restare a indovinare.
 */
export async function assertNotRunning(software: DjSoftware, label: string): Promise<void> {
  const v = await isDjSoftwareRunning(software);
  if (v.unknown) {
    throw new Error(
      `Non è stato possibile verificare se ${label} è in esecuzione, e senza quella ` +
        'verifica la scrittura non parte: se il programma fosse aperto, le modifiche ' +
        'verrebbero sovrascritte o il file danneggiato. Chiudi ' +
        `${label} e riprova.`
    );
  }
  if (v.running) {
    throw new Error(
      `${label} è in esecuzione. Chiudilo prima di continuare: scrivere adesso ` +
        'significa perdere le modifiche quando il programma si chiude, o danneggiare ' +
        'la libreria.'
    );
  }
}
