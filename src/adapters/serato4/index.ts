import { existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

/**
 * Serato DJ Pro 4 — individuazione della libreria.
 *
 * ⚠ Serato 4 e Serato ≤3 NON sono due varianti dello stesso formato: sono due
 * formati diversi, e le due librerie possono coesistere sulla stessa macchina.
 * Il ≤3 è una cartella di file binari TLV (`_Serato_`, vedi `adapters/serato`);
 * il 4 è un database SQLite a grafo. Chi supporta entrambi scrive due
 * implementazioni indipendenti, non un parser con un flag.
 */

export const SERATO4_STATUS = {
  available: true,
  reason:
    'Serato DJ Pro 4 tiene la libreria in un database SQLite, non nella cartella _Serato_. ' +
    'La lettura è completa; in scrittura si creano crate con i brani che Serato conosce già.'
} as const;

export interface Serato4Paths {
  /** Database principale: 50 tabelle. */
  master: string;
  /** Satelliti riconosciuti per nome; possono mancare. */
  root: string | null;
  location: string | null;
}

/** Percorso di `master.sqlite` per la piattaforma corrente, se esiste. */
export function serato4DatabasePath(home = homedir()): string | null {
  const candidates =
    process.platform === 'win32'
      ? [join(home, 'AppData', 'Local', 'Serato', 'Library', 'master.sqlite')]
      : [join(home, 'Library', 'Application Support', 'Serato', 'Library', 'master.sqlite')];
  return candidates.find((p) => existsSync(p)) ?? null;
}

/**
 * I tre file della libreria.
 *
 * I satelliti si riconoscono per nome, come nella specifica: qualunque altro
 * `.sqlite` nella stessa cartella non è affar nostro.
 */
export function serato4Paths(masterPath: string): Serato4Paths {
  const dir = masterPath.replace(/[/\\][^/\\]+$/, '');
  const sat = (name: string) => {
    const p = join(dir, name);
    return existsSync(p) ? p : null;
  };
  return { master: masterPath, root: sat('root.sqlite'), location: sat('location.sqlite') };
}

/**
 * `master.sqlite` è la guardia che distingue un'installazione Serato 4 da una
 * ≤3. La presenza di `_Serato_` non dice nulla: resta lì anche dopo
 * l'aggiornamento a Serato 4.
 */
export function hasSerato4Library(home = homedir()): boolean {
  return serato4DatabasePath(home) !== null;
}
