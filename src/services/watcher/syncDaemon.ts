import { FSWatcher, watch } from 'fs';
import type BetterSqlite3 from 'better-sqlite3';
import { toCamelot } from '@core/camelot';
import { extractVersionLabel } from '@core/versionRegex';
import { logOperation } from '@core/udm';
import { AUDIO_EXTENSIONS, walkFiles } from '@services/fsutil';

/**
 * Sync Daemon "Nuovi Acquisti" (§6 Fase 3.1).
 *
 * Sorveglia una cartella mentre CrateForge è aperto (onestà tecnica: NON è un
 * servizio di sistema che gira ad app chiusa; la UI lo dice). I nuovi file
 * audio vengono analizzati (tag ID3 via lettore iniettabile), normalizzati e
 * parcheggiati nella coda `inbox_items` dell'UDM. Da lì l'utente rivede e
 * genera un XML che importa A MANO in Rekordbox: nessuna iniezione nel
 * master.db, mai.
 */

export interface InboxTagData {
  title: string | null;
  artist: string | null;
  album: string | null;
  genre: string | null;
  year: number | null;
  bpm: number | null;
  musicalKey: string | null;
  durationS: number | null;
}

export type TagReader = (path: string) => Promise<InboxTagData>;

// I types di music-metadata puntano al build browser (core, senza parseFile);
// a runtime Electron/Node risolve l'entry node che ce l'ha.
interface MusicMetadataNode {
  parseFile: (
    p: string,
    o?: { duration?: boolean }
  ) => Promise<{
    common: {
      title?: string;
      artist?: string;
      album?: string;
      genre?: string[];
      year?: number;
      bpm?: number;
      key?: string;
    };
    format: { duration?: number };
  }>;
}

/** Lettore di default basato su music-metadata (import lazy: solo al primo uso). */
export const defaultTagReader: TagReader = async (path) => {
  const mm = (await import('music-metadata')) as unknown as MusicMetadataNode;
  const meta = await mm.parseFile(path, { duration: true });
  const c = meta.common;
  return {
    title: c.title ?? null,
    artist: c.artist ?? null,
    album: c.album ?? null,
    genre: c.genre?.[0] ?? null,
    year: c.year ?? null,
    bpm: typeof c.bpm === 'number' ? c.bpm : null,
    musicalKey: c.key ?? null,
    durationS: meta.format.duration ?? null
  };
};

export interface ScanResult {
  scanned: number;
  added: number;
  skipped: number;
  withIssues: number;
}

export class SyncDaemon {
  private watcher: FSWatcher | null = null;
  private folder: string | null = null;
  private scanning = false;
  private rescanQueued = false;
  private debounceTimer: NodeJS.Timeout | null = null;
  private lastScan: string | null = null;

  constructor(
    private db: BetterSqlite3.Database,
    private tagReader: TagReader = defaultTagReader,
    private onNewItems: (added: number) => void = () => undefined
  ) {}

  status(): { running: boolean; folder: string | null; lastScan: string | null } {
    return { running: this.watcher !== null, folder: this.folder, lastScan: this.lastScan };
  }

  async start(folder: string): Promise<ScanResult> {
    this.stop();
    this.folder = folder;
    // fs.watch ricorsivo è supportato su Windows e macOS (i due target).
    this.watcher = watch(folder, { recursive: true }, () => this.scheduleScan());
    this.watcher.on('error', () => this.stop());
    const first = await this.scanOnce(folder);
    logOperation(this.db, 'watch.start', folder, 'ok', `primo giro: ${first.added} nuovi`);
    return first;
  }

  stop(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = null;
    this.watcher?.close();
    this.watcher = null;
  }

  /** Eventi fs.watch a raffica → un solo rescan, 2s dopo l'ultimo evento. */
  private scheduleScan(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      if (!this.folder) return;
      this.scanOnce(this.folder).catch(() => undefined);
    }, 2000);
  }

  /**
   * Scansione idempotente: aggiunge alla coda solo i file audio non già
   * presenti né in `inbox_items` né nella libreria (`tracks.path`).
   */
  async scanOnce(folder: string): Promise<ScanResult> {
    if (this.scanning) {
      // Un giro alla volta; se arriva un evento durante il giro, ne parte un altro dopo.
      this.rescanQueued = true;
      return { scanned: 0, added: 0, skipped: 0, withIssues: 0 };
    }
    this.scanning = true;
    const result: ScanResult = { scanned: 0, added: 0, skipped: 0, withIssues: 0 };
    try {
      const known = this.db.prepare(
        `SELECT 1 FROM inbox_items WHERE path = ?
         UNION SELECT 1 FROM tracks WHERE path = ?`
      );
      const insert = this.db.prepare(
        `INSERT INTO inbox_items
           (path, title, artist, album, genre, year, bpm, musical_key, camelot,
            duration_s, filesize, has_tag_issues)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for await (const f of walkFiles(folder, AUDIO_EXTENSIONS)) {
        result.scanned++;
        if (known.get(f.path, f.path)) {
          result.skipped++;
          continue;
        }
        let tags: InboxTagData | null = null;
        try {
          tags = await this.tagReader(f.path);
        } catch {
          // tag illeggibili/corrotti: entra comunque, marcato da revisionare (§6 Fase 1.6)
        }
        const issues = tags === null;
        if (issues) result.withIssues++;
        insert.run(
          f.path,
          tags?.title ?? null,
          tags?.artist ?? null,
          tags?.album ?? null,
          tags?.genre ?? null,
          tags?.year ?? null,
          tags?.bpm ?? null,
          tags?.musicalKey ?? null,
          toCamelot(tags?.musicalKey) ?? null,
          tags?.durationS ?? null,
          f.size,
          issues ? 1 : 0
        );
        result.added++;
      }
      this.lastScan = new Date().toISOString();
      if (result.added > 0) this.onNewItems(result.added);
      return result;
    } finally {
      this.scanning = false;
      if (this.rescanQueued) {
        this.rescanQueued = false;
        this.scheduleScan();
      }
    }
  }
}

export interface InboxItem {
  id: number;
  path: string;
  title: string | null;
  artist: string | null;
  album: string | null;
  genre: string | null;
  year: number | null;
  bpm: number | null;
  musical_key: string | null;
  camelot: string | null;
  duration_s: number | null;
  filesize: number | null;
  has_tag_issues: number;
  status: 'new' | 'prepared' | 'dismissed';
  added_at: string;
  version_label?: string | null;
}

export function listInbox(
  db: BetterSqlite3.Database,
  status: 'new' | 'prepared' | 'dismissed' = 'new',
  limit = 500
): InboxItem[] {
  const rows = db
    .prepare(`SELECT * FROM inbox_items WHERE status = ? ORDER BY added_at DESC LIMIT ?`)
    .all(status, Math.min(limit, 2000)) as InboxItem[];
  // Versione (Remix/Bootleg/…) dal titolo o, in mancanza, dal filename.
  for (const r of rows)
    r.version_label = extractVersionLabel(r.title ?? '') ?? extractVersionLabel(r.path);
  return rows;
}

export function setInboxStatus(
  db: BetterSqlite3.Database,
  ids: number[],
  status: 'new' | 'prepared' | 'dismissed'
): number {
  const upd = db.prepare(`UPDATE inbox_items SET status = ? WHERE id = ?`);
  const tx = db.transaction(() => {
    for (const id of ids) upd.run(status, id);
  });
  tx();
  return ids.length;
}
