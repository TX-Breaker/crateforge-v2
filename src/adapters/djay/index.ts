import { existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

/**
 * djay Pro (Algoriddim) — individuazione della libreria.
 *
 * ⚠ Il nome del file è `MediaLibrary.db` CON LE MAIUSCOLE: su filesystem
 * case-sensitive il minuscolo non esiste.
 */

export const DJAY_PROGRAM_NAME = 'Djay Pro';
export const DJAY_DB_FILENAME = 'MediaLibrary.db';
export const DJAY_ROOT_PLAYLIST_UUID = 'mediaItemPlaylist-root';
export const DJAY_ROOT_PLAYLIST_NAME = 'Playlists';

/**
 * ⚠ djay Pro 4 e precedenti non sono supportati: il formato del database è
 * diverso e non è stato analizzato. Meglio rifiutare che leggere male.
 */
export const DJAY_MIN_SUPPORTED_VERSION = 5;

export const DJAY_STATUS = {
  available: true,
  reason:
    'djay Pro tiene la libreria in un archivio chiave-valore, non in una tabella di tracce. ' +
    'La lettura è stata verificata su una libreria reale su Windows, ma solo in lettura ' +
    'e su una libreria piccola: trattala come sperimentale.'
} as const;

/**
 * Cartella dei dati di djay.
 *
 * ⚠ Su Windows NON sta in `%LOCALAPPDATA%`, dove la mette quasi ogni altro
 * programma e dove questo codice la cercava. Verificato il 24/08/2026 su
 * un'installazione reale: `%LOCALAPPDATA%\djay` non esiste affatto, e la
 * libreria vive sotto la cartella Musica dell'utente. Ha senso una volta vista:
 * djay arriva dal Microsoft Store, gira in un contenitore che non ha una
 * `%LOCALAPPDATA%` propria condivisibile, e tratta la libreria come un
 * documento dell'utente invece che come stato dell'applicazione.
 *
 * Conseguenza pratica per chi manutiene: la cartella è dentro lo spazio
 * documenti dell'utente, quindi può essere sincronizzata da OneDrive o simili,
 * e può essere spostata. Per questo `djayDatabasePath` non si limita a questo
 * percorso.
 */
export function djayDataFolder(home = homedir()): string {
  return process.platform === 'win32'
    ? join(home, 'Music', 'djay', 'djay Media Library')
    : join(home, 'Library', 'Application Support', 'djay', 'djay Media Library.djayMediaLibrary');
}

/**
 * Cartella dei backup che djay gestisce da sé: una sottocartella per data,
 * ciascuna con dentro una copia di `djay Media Library`.
 */
export function djayBackupFolder(home = homedir()): string {
  return process.platform === 'win32'
    ? join(home, 'Music', 'djay', 'Backups')
    : join(home, 'Library', 'Application Support', 'djay', 'Backups');
}

/**
 * Percorsi in cui cercare la libreria, in ordine di preferenza.
 *
 * Il primo è quello verificato. Il secondo esiste perché djay è passato dallo
 * Store: la posizione di prima non è sparita per tutti nello stesso momento, e
 * su una macchina aggiornata da una versione vecchia la libreria può essere
 * rimasta dov'era. Cercarlo costa un `existsSync`; non cercarlo costa un
 * «nessuna libreria trovata» a un utente che ce l'ha.
 */
export function djayCandidatePaths(home = homedir()): string[] {
  const dirs =
    process.platform === 'win32'
      ? [
          djayDataFolder(home),
          join(home, 'AppData', 'Local', 'djay', 'djay Media Library')
        ]
      : [djayDataFolder(home)];
  return dirs.map((d) => join(d, DJAY_DB_FILENAME));
}

/** Percorso di `MediaLibrary.db`, se esiste. */
export function djayDatabasePath(home = homedir()): string | null {
  return djayCandidatePaths(home).find((p) => existsSync(p)) ?? null;
}

export function hasDjayLibrary(home = homedir()): boolean {
  return djayDatabasePath(home) !== null;
}
