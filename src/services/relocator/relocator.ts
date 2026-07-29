import type BetterSqlite3 from 'better-sqlite3';
import { existsSync } from 'fs';
import { AUDIO_EXTENSIONS, canonicalizeName, walkFiles } from '../fsutil';
import type { TrackRow } from '@core/udm';

/**
 * basename indipendente dalla piattaforma: splitta su ENTRAMBI i separatori
 * (`/` e `\`). `path.basename` di POSIX non tratta `\` come separatore, quindi
 * su macOS/Linux un path Windows-style salvato nel DB (es. libreria esportata
 * da un altro PC) non verrebbe estratto correttamente. Il relocator è proprio
 * il caso "libreria spostata tra macchine": deve reggere path di ogni stile.
 */
function baseNameAnySep(p: string): string {
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1] || p;
}

/**
 * Relocator Esterno base (§6 Fase 1.5): trova i path rotti, matcha per nome
 * file nella nuova cartella e prepara i dati per un XML di aggiornamento da
 * re-importare in Rekordbox. MAI scrivere il nuovo path nel master.db.
 * (Il matching per fingerprint arriva in Fase 2.)
 */

export interface BrokenTrack {
  track: TrackRow;
  oldPath: string;
}

export interface RelocationMatch {
  track: TrackRow;
  oldPath: string;
  newPath: string | null; // null = nessun match trovato
  ambiguous: string[]; // altri candidati con lo stesso nome
}

export function findBrokenTracks(
  db: BetterSqlite3.Database,
  onProgress?: (checked: number, total: number) => void
): BrokenTrack[] {
  const total = (
    db.prepare(`SELECT COUNT(*) AS c FROM tracks WHERE path IS NOT NULL`).get() as { c: number }
  ).c;
  const broken: BrokenTrack[] = [];
  let checked = 0;
  for (const row of db
    .prepare(`SELECT * FROM tracks WHERE path IS NOT NULL`)
    .iterate() as IterableIterator<TrackRow>) {
    checked++;
    if (row.path && !existsSync(row.path)) {
      broken.push({ track: row, oldPath: row.path });
    }
    if (checked % 500 === 0) onProgress?.(checked, total);
  }
  return broken;
}

export async function matchByFilename(
  broken: BrokenTrack[],
  newRoot: string,
  onProgress?: (scanned: number) => void
): Promise<RelocationMatch[]> {
  // Indice nome-file → path[] della nuova cartella
  const byName = new Map<string, string[]>();
  let scanned = 0;
  for await (const file of walkFiles(newRoot, AUDIO_EXTENSIONS)) {
    scanned++;
    const name = canonicalizeName(baseNameAnySep(file.path));
    const list = byName.get(name);
    if (list) list.push(file.path);
    else byName.set(name, [file.path]);
    if (scanned % 200 === 0) onProgress?.(scanned);
  }

  return broken.map(({ track, oldPath }) => {
    const candidates = byName.get(canonicalizeName(baseNameAnySep(oldPath))) ?? [];
    return {
      track,
      oldPath,
      newPath: candidates[0] ?? null,
      ambiguous: candidates.slice(1)
    };
  });
}
