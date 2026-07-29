import { app } from 'electron';
import { existsSync } from 'fs';
import { join } from 'path';

/**
 * Percorsi di DEFAULT dell'installazione Rekordbox dell'utente corrente.
 *
 * Calcolati dinamicamente dalla home dell'utente (mai hard-coded): valgono sia
 * su questo Mac sia su quello di qualunque altro utente a cui l'app è
 * distribuita. Servono a pre-puntare il file picker (e, se il master.db è già
 * lì, a leggerlo con un clic).
 *
 *   macOS   : ~/Library/Pioneer/rekordbox/master.db
 *   Windows : %APPDATA%\Pioneer\rekordbox\master.db
 */
export interface RekordboxPaths {
  dir: string;
  masterDb: string;
  masterDbExists: boolean;
  optionsJson: string;
  optionsJsonExists: boolean;
}

export function rekordboxDir(): string {
  if (process.platform === 'darwin') {
    return join(app.getPath('home'), 'Library', 'Pioneer', 'rekordbox');
  }
  if (process.platform === 'win32') {
    // appData su Windows = Roaming, dove Rekordbox tiene Pioneer\rekordbox.
    return join(app.getPath('appData'), 'Pioneer', 'rekordbox');
  }
  // Linux: Rekordbox non è supportato, ma restiamo coerenti col resto.
  return join(app.getPath('home'), 'Pioneer', 'rekordbox');
}

/**
 * Percorsi candidati di options.json, in ordine di priorità.
 *
 * Rekordbox 6/7 NON tiene options.json accanto a master.db: sta in
 * ~/Library/Application Support/Pioneer/rekordboxAgent/storage/options.json (mac)
 * o %APPDATA%\Pioneer\rekordboxAgent\storage\options.json (win). La vecchia
 * ipotesi (accanto a master.db) rendeva optionsJsonExists sempre false su rb6/7,
 * spezzando il pre-puntamento del picker e la decifratura companion-file.
 */
function optionsJsonCandidates(): string[] {
  const dir = rekordboxDir();
  const out: string[] = [];
  if (process.platform === 'darwin') {
    out.push(
      join(app.getPath('home'), 'Library', 'Application Support', 'Pioneer', 'rekordboxAgent', 'storage', 'options.json')
    );
  } else if (process.platform === 'win32') {
    out.push(join(app.getPath('appData'), 'Pioneer', 'rekordboxAgent', 'storage', 'options.json'));
  }
  // Fallback: accanto a master.db (versioni più vecchie / layout non standard).
  out.push(join(dir, 'options.json'));
  return out;
}

export function rekordboxDefaultPaths(): RekordboxPaths {
  const dir = rekordboxDir();
  const masterDb = join(dir, 'master.db');
  const candidates = optionsJsonCandidates();
  const optionsJson = candidates.find(existsSync) ?? candidates[candidates.length - 1];
  return {
    dir,
    masterDb,
    masterDbExists: existsSync(masterDb),
    optionsJson,
    optionsJsonExists: existsSync(optionsJson)
  };
}
