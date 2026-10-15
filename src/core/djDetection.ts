import type { DjSoftware } from './djVersions';

/**
 * Forma di un rilevamento di software DJ: ciò che il processo principale
 * restituisce a `detect:djSoftware`.
 *
 * ⚠ Esiste come file di soli tipi, condiviso da processo principale, preload e
 * interfaccia, perché le copie separate sono già divergite tre volte. Il
 * processo principale emetteva sei tipi di sorgente; il preload ne dichiarava
 * cinque, il wizard altri cinque, e in entrambe le copie mancava `serato4db`.
 * Effetti: il `master.sqlite` di Serato 4 veniva instradato al lettore di Engine,
 * e la sua riga nel wizard compariva senza nome perché la tabella dei nomi non
 * aveva la voce. Nessuno dei due errori era visibile a TypeScript, proprio
 * perché ogni copia era coerente con se stessa.
 *
 * Qui non ci sono import di Node o di Electron: anche l'interfaccia lo
 * compila.
 */

export interface DjAppInstall {
  installed: boolean;
  path: string | null;
  version: string | null;
}

export interface DjSourceHint {
  fileName: string | null;
  typicalPath: string;
}

/** Tipo di sorgente da passare all'IPC di import. */
export type DjDetectionKind = 'masterdb' | 'nml' | 'vdjxml' | 'seratoDir' | 'serato4db' | 'enginedb';

export interface DjSoftwareDetection {
  id: DjSoftware;
  found: boolean;
  /** percorso verificato da passare all'import, quando trovato */
  path: string | null;
  companionPath?: string | null;
  checked: string[];
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
  kind: DjDetectionKind;
}
