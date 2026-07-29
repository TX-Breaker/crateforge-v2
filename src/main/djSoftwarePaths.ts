import { app } from 'electron';
import { existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { rekordboxDefaultPaths } from './rekordboxPaths';

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

export type DjSoftwareId = 'rekordbox' | 'traktor' | 'virtualdj' | 'serato' | 'engine';

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
  /**
   * Limite dichiarato del canale: Serato si legge ma non si riscrive, Engine
   * spesso vive su un supporto esterno. La UI lo mostra sulla card, non in nota.
   */
  limit?: 'readOnly' | 'external' | 'directWrite';
  /** tipo di sorgente da passare alla IPC di import */
  kind: 'masterdb' | 'nml' | 'vdjxml' | 'seratoDir' | 'enginedb';
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

function virtualdjCandidates(): string[] {
  const out: string[] = [];
  if (process.platform === 'win32') {
    out.push(join(app.getPath('appData'), 'VirtualDJ', 'database.xml'));
    out.push(join(documents(), 'VirtualDJ', 'database.xml'));
  } else {
    out.push(join(home(), 'Library', 'Application Support', 'VirtualDJ', 'database.xml'));
    out.push(join(documents(), 'VirtualDJ', 'database.xml'));
  }
  return out;
}

function seratoCandidates(): string[] {
  return [join(music(), '_Serato_'), join(home(), '_Serato_'), join(documents(), '_Serato_')];
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

export function detectDjSoftware(): DjSoftwareDetection[] {
  const rb = rekordboxDefaultPaths();

  const traktorChecked = traktorCandidates();
  const traktorPath = firstExisting(traktorChecked);

  const vdjChecked = virtualdjCandidates();
  const vdjPath = firstExisting(vdjChecked);

  const seratoChecked = seratoCandidates();
  const seratoPath = firstExisting(seratoChecked);

  const engineChecked = engineCandidates();
  const enginePath = firstExisting(engineChecked);

  return [
    {
      id: 'rekordbox',
      found: rb.masterDbExists,
      path: rb.masterDbExists ? rb.masterDb : null,
      companionPath: rb.optionsJsonExists ? rb.optionsJson : null,
      checked: [rb.masterDb, rb.optionsJson],
      modifiedAt: modifiedAt(rb.masterDbExists ? rb.masterDb : null),
      kind: 'masterdb'
    },
    {
      id: 'traktor',
      found: traktorPath !== null,
      path: traktorPath,
      checked: traktorChecked,
      modifiedAt: modifiedAt(traktorPath),
      kind: 'nml'
    },
    {
      id: 'virtualdj',
      found: vdjPath !== null,
      path: vdjPath,
      checked: vdjChecked,
      modifiedAt: modifiedAt(vdjPath),
      kind: 'vdjxml'
    },
    {
      id: 'serato',
      found: seratoPath !== null,
      path: seratoPath,
      checked: seratoChecked,
      modifiedAt: modifiedAt(seratoPath),
      // La scrittura verso Serato esiste (cue e loop nei tag dei file audio,
      // crate per le playlist) ma tocca gli originali: la card lo dichiara come
      // limite del canale, non come impossibilità.
      limit: 'directWrite',
      kind: 'seratoDir'
    },
    {
      id: 'engine',
      found: enginePath !== null,
      path: enginePath,
      checked: engineChecked,
      modifiedAt: modifiedAt(enginePath),
      // Engine vive spesso su chiavetta o SSD esterno: se non c'è, non è un errore.
      limit: enginePath ? undefined : 'external',
      kind: 'enginedb'
    }
  ];
}
