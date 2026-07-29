import { copyFile, mkdir, stat } from 'fs/promises';
import { existsSync } from 'fs';
import { basename, dirname, join, relative } from 'path';
import { AUDIO_EXTENSIONS, copyWithVerify, timestampDir, walkFiles } from '../fsutil';

/**
 * Backup Smart Incrementale (§6 Fase 1.1).
 * 1) Snapshot datato di master.db + options.json (indispensabile per decifrare).
 * 2) Confronto stile rsync musica → backup: copia solo nuovi/modificati
 *    (mtime + size; hash opzionale).
 * Gli originali sono aperti in sola lettura; si scrive solo nella destinazione.
 */

export interface BackupPlanItem {
  src: string;
  dest: string;
  reason: 'new' | 'modified';
  size: number;
}

export interface BackupPlan {
  dbSnapshotDir: string | null;
  items: BackupPlanItem[];
  totalBytes: number;
  scannedFiles: number;
}

export interface BackupOptions {
  musicDir: string;
  backupDir: string;
  masterDbPath?: string; // opzionale: in modalità solo-XML può mancare
  optionsJsonPath?: string;
  useHash?: boolean;
  onProgress?: (done: number, total: number, phase: 'scan' | 'copy') => void;
}

/** Fase di piano (dry-run): calcola cosa verrebbe copiato, senza toccare nulla. */
export async function planBackup(opts: BackupOptions): Promise<BackupPlan> {
  const items: BackupPlanItem[] = [];
  let scanned = 0;
  let totalBytes = 0;

  for await (const file of walkFiles(opts.musicDir, AUDIO_EXTENSIONS)) {
    scanned++;
    const rel = relative(opts.musicDir, file.path);
    const dest = join(opts.backupDir, 'music', rel);
    let reason: 'new' | 'modified' | null = null;
    try {
      const destStat = await stat(dest);
      if (destStat.size !== file.size || destStat.mtimeMs < file.mtimeMs) {
        reason = 'modified';
      }
    } catch {
      reason = 'new';
    }
    if (reason) {
      items.push({ src: file.path, dest, reason, size: file.size });
      totalBytes += file.size;
    }
    if (scanned % 200 === 0) opts.onProgress?.(scanned, scanned, 'scan');
  }

  return {
    dbSnapshotDir:
      opts.masterDbPath && existsSync(opts.masterDbPath)
        ? join(opts.backupDir, 'db-snapshots', timestampDir())
        : null,
    items,
    totalBytes,
    scannedFiles: scanned
  };
}

export interface BackupResult {
  copied: number;
  failed: { src: string; error: string }[];
  dbSnapshotDir: string | null;
}

/** Esecuzione del piano. Ogni copia è verificata via hash (§3.5). */
export async function executeBackup(plan: BackupPlan, opts: BackupOptions): Promise<BackupResult> {
  const failed: BackupResult['failed'] = [];
  let copied = 0;

  // 1) Snapshot DB prima di tutto (§3.2)
  let dbSnapshotDir: string | null = null;
  if (plan.dbSnapshotDir && opts.masterDbPath) {
    dbSnapshotDir = plan.dbSnapshotDir;
    await mkdir(dbSnapshotDir, { recursive: true });
    await copyWithVerify(opts.masterDbPath, join(dbSnapshotDir, basename(opts.masterDbPath)));
    if (opts.optionsJsonPath && existsSync(opts.optionsJsonPath)) {
      await copyWithVerify(
        opts.optionsJsonPath,
        join(dbSnapshotDir, basename(opts.optionsJsonPath))
      );
    }
  }

  // 2) Copia incrementale
  for (let i = 0; i < plan.items.length; i++) {
    const item = plan.items[i];
    try {
      if (opts.useHash) {
        await copyWithVerify(item.src, item.dest);
      } else {
        await mkdir(dirname(item.dest), { recursive: true });
        await copyFile(item.src, item.dest);
      }
      copied++;
    } catch (err) {
      failed.push({ src: item.src, error: err instanceof Error ? err.message : String(err) });
    }
    if (i % 25 === 0 || i === plan.items.length - 1) {
      opts.onProgress?.(i + 1, plan.items.length, 'copy');
    }
  }

  return { copied, failed, dbSnapshotDir };
}
