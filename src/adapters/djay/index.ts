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
    'La lettura è implementata sulla specifica ma non è ancora stata verificata su una ' +
    'libreria reale: trattala come sperimentale.'
} as const;

/** Cartella dei dati di djay per la piattaforma corrente. */
export function djayDataFolder(home = homedir()): string {
  return process.platform === 'win32'
    ? join(home, 'AppData', 'Local', 'djay', 'djay Media Library')
    : join(home, 'Library', 'Application Support', 'djay', 'djay Media Library.djayMediaLibrary');
}

/** Cartella dei backup che djay gestisce da sé. */
export function djayBackupFolder(home = homedir()): string {
  return process.platform === 'win32'
    ? join(home, 'AppData', 'Local', 'djay', 'Backups')
    : join(home, 'Library', 'Application Support', 'djay', 'Backups');
}

/** Percorso di `MediaLibrary.db`, se esiste. */
export function djayDatabasePath(home = homedir()): string | null {
  const p = join(djayDataFolder(home), DJAY_DB_FILENAME);
  return existsSync(p) ? p : null;
}

export function hasDjayLibrary(home = homedir()): boolean {
  return djayDatabasePath(home) !== null;
}
