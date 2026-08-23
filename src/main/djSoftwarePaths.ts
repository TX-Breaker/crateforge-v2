import { app } from 'electron';
import { closeSync, existsSync, openSync, readSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { rekordboxDefaultPaths } from './rekordboxPaths';
import type { DjSoftware } from '@core/djVersions';

/**
 * Rilevamento delle installazioni DJ presenti su QUESTA macchina.
 *
 * Regole non negoziabili (§6.1 del design system):
 *  - i percorsi si derivano dalla home dell'utente con `app.getPath`, mai
 *    hard-coded: valgono per qualunque utente a cui l'app è distribuita;
 *  - ogni candidato è verificato su disco con `existsSync` PRIMA di comparire:
 *    CrateForge non dichiara mai di aver rilevato qualcosa che non ha visto;
 *  - se nessun candidato esiste la card dice "non trovato" e offre la
 *    selezione manuale — le posizioni di default cambiano con la versione.
 *
 * Qui si guarda soltanto: nessun file viene aperto, letto o copiato.
 */

/**
 * Identificatore del software, DERIVATO dal registro delle versioni collaudate.
 *
 * ⚠ Era un elenco a sé: un ottavo posto in cui la lista dei software supportati
 * andava tenuta allineata a mano. Aggiungerne uno significava toccare tutti gli
 * elenchi e accorgersi degli altri solo quando qualcosa non compariva. Ora
 * l'unica fonte è `DjSoftware`: se il registro cresce, il rilevamento lo sa.
 */
export type DjSoftwareId = DjSoftware;

/**
 * L'APPLICAZIONE installata, che è una cosa diversa dalla sua LIBRERIA.
 *
 * Distinguerle non è pedanteria: "VirtualDJ non installato" e "VirtualDJ
 * installato ma non ha ancora una libreria" portano l'utente a fare due cose
 * diverse, e il primo messaggio dato al posto del secondo lo manda a cercare
 * un file che non esiste. Su questa macchina è successo esattamente questo.
 */
export interface DjAppInstall {
  installed: boolean;
  /** cartella dell'installazione, verificata su disco */
  path: string | null;
  /** versione, quando ricavabile senza lanciare processi */
  version: string | null;
}

/**
 * Che cosa deve cercare l'utente se tocca a lui. Serve al selettore file: un
 * filtro per estensione non basta — nella cartella di VirtualDJ l'unico .xml
 * è `settings.xml`, ed è il file sbagliato.
 */
export interface DjSourceHint {
  /** nome esatto del file da cercare (null per Serato: è una cartella) */
  fileName: string | null;
  /** dove sta di solito su QUESTA piattaforma, già espanso */
  typicalPath: string;
}

export interface DjSoftwareDetection {
  id: DjSoftwareId;
  /** true se almeno un candidato esiste davvero su disco */
  found: boolean;
  /** percorso verificato da passare all'import, quando trovato */
  path: string | null;
  /** percorso di supporto (options.json di Rekordbox), se esiste */
  companionPath?: string | null;
  /** percorsi controllati, per poterli mostrare in chiaro all'utente */
  checked: string[];
  /** ultima modifica del file/cartella trovato, ISO */
  modifiedAt: string | null;
  /** l'applicazione installata, indipendentemente dalla sua libreria */
  app: DjAppInstall;
  /** cosa cercare, se la selezione passa all'utente */
  hint: DjSourceHint;
  /**
   * Limite dichiarato del canale: Serato si legge ma non si riscrive, Engine
   * spesso vive su un supporto esterno. La UI lo mostra sulla card, non in nota.
   */
  limit?: 'readOnly' | 'external' | 'directWrite';
  /** tipo di sorgente da passare alla IPC di import */
  kind: 'masterdb' | 'nml' | 'vdjxml' | 'seratoDir' | 'serato4db' | 'enginedb';
}

function firstExisting(candidates: string[]): string | null {
  return candidates.find((c) => {
    try {
      return existsSync(c);
    } catch {
      return false;
    }
  }) ?? null;
}

function modifiedAt(path: string | null): string | null {
  if (!path) return null;
  try {
    return statSync(path).mtime.toISOString();
  } catch {
    return null;
  }
}

const home = () => app.getPath('home');
const documents = () => {
  try {
    return app.getPath('documents');
  } catch {
    return join(home(), 'Documents');
  }
};
const music = () => {
  try {
    return app.getPath('music');
  } catch {
    return join(home(), 'Music');
  }
};

/**
 * Traktor numera la cartella con la versione (Traktor 3.11.1, Traktor 4.0.2…):
 * l'unica strada onesta è enumerare la cartella "Native Instruments" e tenere
 * le sottocartelle che contengono davvero un collection.nml.
 */
function traktorCandidates(): string[] {
  const root = join(documents(), 'Native Instruments');
  const out: string[] = [];
  try {
    if (existsSync(root)) {
      for (const entry of readdirSync(root, { withFileTypes: true })) {
        if (entry.isDirectory() && /^Traktor/i.test(entry.name)) {
          out.push(join(root, entry.name, 'collection.nml'));
        }
      }
    }
  } catch {
    // cartella non leggibile: si passa ai candidati fissi
  }
  // Ordine: versioni più recenti prima (ordinamento lessicale inverso).
  out.sort().reverse();
  out.push(join(root, 'Traktor', 'collection.nml'));
  return out;
}

/**
 * VirtualDJ è il più sparpagliato di tutti.
 *
 * Dalla versione 8 la cartella di lavoro su Windows sta in LOCALAPPDATA, non in
 * Roaming — cercare solo in Roaming (com'era qui) significa non trovare
 * un'installazione perfettamente funzionante. In più VirtualDJ tiene un
 * database PER DISCO: se la musica sta su un disco esterno, la libreria di
 * quei brani è in `X:\VirtualDJ\database.xml` e non altrove.
 *
 * Si guardano tutti i posti plausibili, in ordine di probabilità.
 */
function virtualdjCandidates(): string[] {
  const out: string[] = [];
  if (process.platform === 'win32') {
    out.push(join(app.getPath('userData'), '..', '..', 'Local', 'VirtualDJ', 'database.xml'));
    out.push(join(process.env.LOCALAPPDATA ?? '', 'VirtualDJ', 'database.xml'));
    out.push(join(app.getPath('appData'), 'VirtualDJ', 'database.xml'));
    out.push(join(documents(), 'VirtualDJ', 'database.xml'));
    out.push(join(home(), 'VirtualDJ', 'database.xml'));
    // Un database per disco: si guardano le radici dei volumi montati.
    for (const letter of 'DEFGHIJKLMNOPQRSTUVWXYZ') {
      out.push(`${letter}:\\VirtualDJ\\database.xml`);
    }
  } else {
    out.push(join(home(), 'Library', 'Application Support', 'VirtualDJ', 'database.xml'));
    out.push(join(documents(), 'VirtualDJ', 'database.xml'));
    out.push(join(home(), 'VirtualDJ', 'database.xml'));
  }
  return out.filter((p) => !p.includes('\u0000') && p.length > 3);
}

/** Cartella di lavoro di VirtualDJ, dove vivono settings.xml e i report. */
function virtualdjHome(): string | null {
  const candidates =
    process.platform === 'win32'
      ? [
          join(process.env.LOCALAPPDATA ?? '', 'VirtualDJ'),
          join(app.getPath('appData'), 'VirtualDJ'),
          join(documents(), 'VirtualDJ')
        ]
      : [join(home(), 'Library', 'Application Support', 'VirtualDJ'), join(documents(), 'VirtualDJ')];
  return firstExisting(candidates.filter((c) => c.length > 3));
}

function seratoCandidates(): string[] {
  return [join(music(), '_Serato_'), join(home(), '_Serato_'), join(documents(), '_Serato_')];
}

/**
 * Serato DJ Pro 4: `master.sqlite`.
 *
 * ⚠ Percorso completamente diverso dalla cartella `_Serato_` del ≤3, e sotto
 * `AppData\Local` invece che nella cartella musicale: cercare il 4 dove sta il
 * ≤3 non lo trova mai.
 */
function serato4Candidates(): string[] {
  return process.platform === 'win32'
    ? [join(process.env.LOCALAPPDATA ?? '', 'Serato', 'Library', 'master.sqlite')]
    : [join(home(), 'Library', 'Application Support', 'Serato', 'Library', 'master.sqlite')];
}

function engineCandidates(): string[] {
  const names = ['Engine Library', 'Engine Library 2'];
  const out: string[] = [];
  for (const n of names) {
    out.push(join(music(), n, 'Database2', 'm.db'));
    out.push(join(documents(), n, 'Database2', 'm.db'));
  }
  return out;
}

/* ------------------------------------------------------------------------ */
/*  Applicazioni installate                                                   */
/* ------------------------------------------------------------------------ */

const programRoots = (): string[] =>
  process.platform === 'win32'
    ? ['C:\\Program Files', 'C:\\Program Files (x86)']
    : ['/Applications', '/Applications/Native Instruments'];

/**
 * Cerca una cartella figlia il cui nome corrisponde al pattern. Il pattern è
 * ancorato di proposito: su questa macchina c'è "Cheat Engine 7.3", e una
 * ricerca per sottostringa avrebbe annunciato Engine DJ installato.
 */
function findAppDir(pattern: RegExp): string | null {
  for (const root of programRoots()) {
    if (!existsSync(root)) continue;
    try {
      for (const entry of readdirSync(root, { withFileTypes: true })) {
        if (entry.isDirectory() && pattern.test(entry.name)) return join(root, entry.name);
      }
    } catch {
      /* cartella non leggibile: nessuna informazione, non un errore */
    }
  }
  return null;
}

/** Versione dal NOME della cartella ("rekordbox 7.2.16", "Traktor Pro 3"). */
function versionFromDirName(dir: string | null): string | null {
  if (!dir) return null;
  return dir.split(/[\\/]/).pop()?.match(/(\d+(?:\.\d+)+|\d+)$/)?.[1] ?? null;
}

/**
 * VirtualDJ scrive la propria versione in testa al report di sessione:
 * `--- VirtualDJ System Report --- 850.9482.pc64.2236 --- …`
 * dove 850 sta per 8.5.0. È l'unico marcatore leggibile da file senza aprire
 * l'eseguibile, e leggere un file è ciò che questo modulo sa fare.
 */
function virtualdjVersion(vdjHome: string | null): string | null {
  if (!vdjHome) return null;
  const report = join(vdjHome, 'systemreport_session.txt');
  if (!existsSync(report)) return null;
  try {
    const fd = openSync(report, 'r');
    const buf = Buffer.alloc(256);
    const read = readSync(fd, buf, 0, 256, 0);
    closeSync(fd);
    const head = buf.subarray(0, read).toString('utf-8');
    const m = head.match(/VirtualDJ System Report\s*---\s*(\d)(\d)(\d)\b/i);
    return m ? `${m[1]}.${m[2]}.${m[3]}` : null;
  } catch {
    return null;
  }
}

/**
 * Serato 4 e Serato ≤3 sono due FORMATI ma un solo PROGRAMMA: l'installazione,
 * e quindi il suggerimento su dove cercarla, sono gli stessi.
 *
 * Il tipo di ritorno esclude `serato4` di proposito: così il compilatore sa che
 * gli switch a valle non devono trattarlo, e continua a segnalare se un giorno
 * si aggiunge un software senza gestirlo.
 */
type AppKey = Exclude<DjSoftwareId, 'serato4'>;

function appKeyOf(id: DjSoftwareId): AppKey {
  return id === 'serato4' ? 'serato' : id;
}

function appInstall(id: DjSoftwareId, vdjHome: string | null): DjAppInstall {
  const key = appKeyOf(id);
  const none: DjAppInstall = { installed: false, path: null, version: null };
  switch (key) {
    case 'rekordbox': {
      // La cartella di installazione contiene una sottocartella per versione.
      const root = findAppDir(/^rekordbox$/i);
      if (!root) {
        const direct = findAppDir(/^rekordbox[\s_]?\d/i);
        return direct
          ? { installed: true, path: direct, version: versionFromDirName(direct) }
          : none;
      }
      try {
        const versioned = readdirSync(root, { withFileTypes: true })
          .filter((e) => e.isDirectory() && /^rekordbox\s+\d/i.test(e.name))
          .map((e) => join(root, e.name))
          .sort()
          .reverse();
        const pick = versioned[0] ?? root;
        return { installed: true, path: pick, version: versionFromDirName(pick) };
      } catch {
        return { installed: true, path: root, version: null };
      }
    }
    case 'engine': {
      const dir = findAppDir(/^Engine DJ(\.app)?$/i);
      return dir ? { installed: true, path: dir, version: versionFromDirName(dir) } : none;
    }
    case 'serato': {
      const dir = findAppDir(/^Serato( DJ.*)?(\.app)?$/i);
      return dir ? { installed: true, path: dir, version: versionFromDirName(dir) } : none;
    }
    case 'traktor': {
      const dir = findAppDir(/^Traktor( Pro)?[\s_]?\d/i) ?? findAppDir(/^Traktor( Pro)?(\.app)?$/i);
      return dir ? { installed: true, path: dir, version: versionFromDirName(dir) } : none;
    }
    case 'virtualdj': {
      // La cartella di lavoro conta quanto l'eseguibile: se c'è, VirtualDJ è
      // stato avviato almeno una volta su questo computer.
      const dir = findAppDir(/^VirtualDJ(\.app)?$/i) ?? vdjHome;
      return dir
        ? { installed: true, path: dir, version: virtualdjVersion(vdjHome) }
        : none;
    }
  }
}

/** Nome del file da cercare e percorso tipico, per guidare la scelta manuale. */
function hintFor(id: DjSoftwareId, vdjHome: string | null): DjSourceHint {
  const key = appKeyOf(id);
  const win = process.platform === 'win32';
  switch (key) {
    case 'rekordbox':
      return {
        fileName: 'master.db',
        typicalPath: rekordboxDefaultPaths().masterDb
      };
    case 'traktor':
      return {
        fileName: 'collection.nml',
        typicalPath: join(documents(), 'Native Instruments', 'Traktor <versione>', 'collection.nml')
      };
    case 'virtualdj':
      return {
        fileName: 'database.xml',
        typicalPath: vdjHome
          ? join(vdjHome, 'database.xml')
          : win
            ? join(process.env.LOCALAPPDATA ?? '%LOCALAPPDATA%', 'VirtualDJ', 'database.xml')
            : join(home(), 'Library', 'Application Support', 'VirtualDJ', 'database.xml')
      };
    case 'serato':
      return { fileName: null, typicalPath: join(music(), '_Serato_') };
    case 'engine':
      return { fileName: 'm.db', typicalPath: join(music(), 'Engine Library', 'Database2', 'm.db') };
  }
}

export function detectDjSoftware(): DjSoftwareDetection[] {
  const rb = rekordboxDefaultPaths();

  const traktorChecked = traktorCandidates();
  const traktorPath = firstExisting(traktorChecked);

  const vdjChecked = virtualdjCandidates();
  const vdjPath = firstExisting(vdjChecked);

  const seratoChecked = seratoCandidates();
  const seratoPath = firstExisting(seratoChecked);

  /* ⚠ Serato 4 non sostituisce la cartella `_Serato_`: le due librerie
     coesistono, e dopo un aggiornamento a Serato 4 la vecchia resta lì. Vanno
     quindi cercate ENTRAMBE, altrimenti su una macchina aggiornata si rileva il
     formato che l'utente non usa più. */
  const serato4Checked = serato4Candidates();
  const serato4Path = firstExisting(serato4Checked);

  const engineChecked = engineCandidates();
  const enginePath = firstExisting(engineChecked);

  const vdjHome = virtualdjHome();

  return [
    {
      id: 'rekordbox',
      found: rb.masterDbExists,
      path: rb.masterDbExists ? rb.masterDb : null,
      companionPath: rb.optionsJsonExists ? rb.optionsJson : null,
      checked: [rb.masterDb, rb.optionsJson],
      modifiedAt: modifiedAt(rb.masterDbExists ? rb.masterDb : null),
      app: appInstall('rekordbox', vdjHome),
      hint: hintFor('rekordbox', vdjHome),
      kind: 'masterdb'
    },
    {
      id: 'traktor',
      found: traktorPath !== null,
      path: traktorPath,
      checked: traktorChecked,
      modifiedAt: modifiedAt(traktorPath),
      app: appInstall('traktor', vdjHome),
      hint: hintFor('traktor', vdjHome),
      kind: 'nml'
    },
    {
      id: 'virtualdj',
      found: vdjPath !== null,
      path: vdjPath,
      checked: vdjChecked,
      modifiedAt: modifiedAt(vdjPath),
      app: appInstall('virtualdj', vdjHome),
      hint: hintFor('virtualdj', vdjHome),
      kind: 'vdjxml'
    },
    {
      id: 'serato',
      found: seratoPath !== null,
      path: seratoPath,
      checked: seratoChecked,
      modifiedAt: modifiedAt(seratoPath),
      app: appInstall('serato', vdjHome),
      hint: hintFor('serato', vdjHome),
      // La scrittura verso Serato esiste (cue e loop nei tag dei file audio,
      // crate per le playlist) ma tocca gli originali: la card lo dichiara come
      // limite del canale, non come impossibilità.
      limit: 'directWrite',
      kind: 'seratoDir'
    },
    {
      id: 'serato4',
      found: serato4Path !== null,
      path: serato4Path,
      checked: serato4Checked,
      modifiedAt: modifiedAt(serato4Path),
      app: appInstall('serato', vdjHome),
      hint: hintFor('serato', vdjHome),
      /* La scrittura verso Serato 4 tocca il database dell'utente e passa dai
         gate come le altre; il limite dichiarato è lo stesso del ≤3. */
      limit: 'directWrite',
      kind: 'serato4db'
    },
    {
      id: 'engine',
      found: enginePath !== null,
      path: enginePath,
      checked: engineChecked,
      modifiedAt: modifiedAt(enginePath),
      app: appInstall('engine', vdjHome),
      hint: hintFor('engine', vdjHome),
      // Engine vive spesso su chiavetta o SSD esterno: se non c'è, non è un errore.
      limit: enginePath ? undefined : 'external',
      kind: 'enginedb'
    }
  ];
}
