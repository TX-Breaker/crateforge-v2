import type BetterSqlite3 from 'better-sqlite3';
import { mkdir, rename, rm, stat, writeFile } from 'fs/promises';
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { basename, dirname, join } from 'path';
import { AUDIO_EXTENSIONS, canonicalizePath, walkFiles } from '../fsutil';
import { logOperation } from '@core/udm';

/**
 * Cacciatore di File Orfani (§6 Fase 1.2): file audio su disco ma assenti
 * dal DB Rekordbox (via UDM). Solo diff + anteprima; l'azione vera passa da
 * doppia conferma UI e NON cancella mai definitivamente da sola: sposta in
 * una cartella di quarantena dell'app, reversibile.
 */

export interface OrphanFile {
  path: string;
  size: number;
  mtimeMs: number;
}

export interface OrphanScanResult {
  orphans: OrphanFile[];
  scannedFiles: number;
  knownTracks: number;
  reclaimableBytes: number;
}

export async function findOrphans(
  db: BetterSqlite3.Database,
  musicDir: string,
  onProgress?: (scanned: number) => void
): Promise<OrphanScanResult> {
  // Path noti dal DB: set in RAM di sole stringhe (decine di MB max, non oggetti).
  // canonicalizePath normalizza a NFC: senza, i brani con accenti su macOS
  // (disco NFD vs DB NFC) sarebbero tutti falsi orfani → rischio cancellazione.
  const known = new Set<string>();
  for (const row of db.prepare(`SELECT path FROM tracks WHERE path IS NOT NULL`).iterate()) {
    known.add(canonicalizePath((row as { path: string }).path));
  }

  const orphans: OrphanFile[] = [];
  let scanned = 0;
  let reclaimable = 0;
  for await (const file of walkFiles(musicDir, AUDIO_EXTENSIONS)) {
    scanned++;
    if (!known.has(canonicalizePath(file.path))) {
      orphans.push({ path: file.path, size: file.size, mtimeMs: file.mtimeMs });
      reclaimable += file.size;
    }
    if (scanned % 200 === 0) onProgress?.(scanned);
  }

  return {
    orphans,
    scannedFiles: scanned,
    knownTracks: known.size,
    reclaimableBytes: reclaimable
  };
}

export interface QuarantineResult {
  moved: number;
  failed: { path: string; error: string }[];
  quarantineDir: string;
}

/**
 * Sposta gli orfani selezionati nella cartella di quarantena dell'app.
 * Reversibile: nessuna cancellazione definitiva qui.
 */
export async function quarantineOrphans(
  db: BetterSqlite3.Database,
  files: string[],
  quarantineRoot: string,
  dryRun: boolean
): Promise<QuarantineResult> {
  const quarantineDir = join(quarantineRoot, new Date().toISOString().slice(0, 10));
  const failed: QuarantineResult['failed'] = [];
  let moved = 0;

  if (dryRun) {
    logOperation(db, 'orphans.quarantine', quarantineDir, 'dry-run', `${files.length} file`);
    return { moved: files.length, failed, quarantineDir };
  }

  await mkdir(quarantineDir, { recursive: true });
  const manifest: { from: string; to: string; at: string }[] = [];
  for (const f of files) {
    try {
      // Trova un dest LIBERO prima di spostare: `rename` sovrascrive la
      // destinazione, quindi due orfani con lo stesso nome file si
      // distruggerebbero a vicenda (il ramo EEXIST non scatta sul rename).
      let dest = join(quarantineDir, basename(f));
      let n = 1;
      while (existsSync(dest)) {
        if (n >= 1000) throw new Error('Troppi file omonimi in quarantena: operazione saltata');
        dest = join(quarantineDir, `${n++}_${basename(f)}`);
      }
      try {
        await rename(f, dest);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'EXDEV') {
          // volume diverso: copia + elimina non è "move" atomico → rifiuta, più sicuro
          throw new Error('File su un volume diverso dalla quarantena: operazione saltata');
        }
        throw err;
      }
      moved++;
      manifest.push({ from: f, to: dest, at: new Date().toISOString() });
      logOperation(db, 'orphans.quarantine', f, 'ok', `→ ${dest}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      failed.push({ path: f, error: msg });
      logOperation(db, 'orphans.quarantine', f, 'error', msg);
    }
  }

  // Manifest della quarantena: senza la provenienza di ogni file, "reversibile"
  // sarebbe una parola e basta. È un file JSON accanto ai file spostati.
  if (manifest.length > 0) {
    const manifestPath = join(quarantineDir, MANIFEST_NAME);
    const existing = readManifest(quarantineDir);
    await writeFile(manifestPath, JSON.stringify([...existing, ...manifest], null, 2), 'utf-8');
  }

  return { moved, failed, quarantineDir };
}

export interface QuarantineEntry {
  from: string;
  to: string;
  at: string;
}

export const MANIFEST_NAME = 'crateforge-quarantine.json';

/** Manifest di una cartella di quarantena (vuoto se assente o illeggibile). */
export function readManifest(quarantineDir: string): QuarantineEntry[] {
  const p = join(quarantineDir, MANIFEST_NAME);
  if (!existsSync(p)) return [];
  try {
    const parsed = JSON.parse(readFileSync(p, 'utf-8'));
    return Array.isArray(parsed) ? (parsed as QuarantineEntry[]) : [];
  } catch {
    return [];
  }
}

/**
 * Elenca il contenuto in quarantena sotto una radice, raggruppato per giornata
 * (la quarantena crea una sottocartella per data). Include lo stato di ogni
 * voce: se il file è ancora lì e se la posizione di origine è di nuovo libera.
 */
export function listQuarantine(quarantineRoot: string): {
  dir: string;
  entries: (QuarantineEntry & { present: boolean; originFree: boolean; size: number | null })[];
}[] {
  if (!existsSync(quarantineRoot)) return [];
  const out: ReturnType<typeof listQuarantine> = [];
  for (const entry of readdirSync(quarantineRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = join(quarantineRoot, entry.name);
    const entries = readManifest(dir).map((e) => {
      let size: number | null = null;
      try {
        size = existsSync(e.to) ? statSync(e.to).size : null;
      } catch {
        size = null;
      }
      return { ...e, present: existsSync(e.to), originFree: !existsSync(e.from), size };
    });
    if (entries.length > 0) out.push({ dir, entries });
  }
  return out;
}

export interface RestoreResult {
  restored: number;
  skipped: { path: string; reason: string }[];
}

/**
 * Riporta i file dalla quarantena alla loro posizione originale — l'annulla
 * della quarantena. Non sovrascrive MAI: se all'origine c'è già qualcosa, la
 * voce viene saltata e dichiarata, non risolta di nascosto.
 */
export async function restoreFromQuarantine(
  db: BetterSqlite3.Database,
  quarantineDir: string,
  files: string[],
  dryRun: boolean
): Promise<RestoreResult> {
  const manifest = readManifest(quarantineDir);
  const skipped: RestoreResult['skipped'] = [];
  let restored = 0;

  const wanted = new Set(files);
  const targets = manifest.filter((m) => wanted.has(m.to));

  if (dryRun) {
    for (const m of targets) {
      if (!existsSync(m.to)) skipped.push({ path: m.to, reason: 'missing' });
      else if (existsSync(m.from)) skipped.push({ path: m.from, reason: 'occupied' });
      else restored++;
    }
    logOperation(db, 'orphans.restore', quarantineDir, 'dry-run', `${targets.length} file`);
    return { restored, skipped };
  }

  const done = new Set<string>();
  for (const m of targets) {
    try {
      if (!existsSync(m.to)) {
        skipped.push({ path: m.to, reason: 'missing' });
        continue;
      }
      if (existsSync(m.from)) {
        skipped.push({ path: m.from, reason: 'occupied' });
        continue;
      }
      await mkdir(dirname(m.from), { recursive: true });
      await rename(m.to, m.from);
      restored++;
      done.add(m.to);
      logOperation(db, 'orphans.restore', m.from, 'ok', `← ${m.to}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      skipped.push({ path: m.to, reason: msg });
      logOperation(db, 'orphans.restore', m.to, 'error', msg);
    }
  }

  if (done.size > 0) {
    const left = manifest.filter((m) => !done.has(m.to));
    await writeFile(join(quarantineDir, MANIFEST_NAME), JSON.stringify(left, null, 2), 'utf-8');
  }

  return { restored, skipped };
}

export interface DeleteResult {
  deleted: number;
  freedBytes: number;
  failed: { path: string; error: string }[];
}

/**
 * Eliminazione DEFINITIVA degli orfani (fase intermedia, opt-in "scritture
 * dirette"). Irreversibile per design: la UI la sblocca solo con il setting
 * dedicato attivo e doppia conferma "ELIMINA". La quarantena resta la strada
 * consigliata.
 */
export async function deleteOrphans(
  db: BetterSqlite3.Database,
  files: string[],
  dryRun: boolean
): Promise<DeleteResult> {
  const failed: DeleteResult['failed'] = [];
  let deleted = 0;
  let freedBytes = 0;

  if (dryRun) {
    for (const f of files) {
      try {
        freedBytes += (await stat(f)).size;
      } catch {
        // file già assente: non conta
      }
    }
    logOperation(db, 'orphans.delete', null, 'dry-run', `${files.length} file, ${freedBytes} byte`);
    return { deleted: files.length, freedBytes, failed };
  }

  for (const f of files) {
    try {
      const size = (await stat(f)).size;
      await rm(f);
      deleted++;
      freedBytes += size;
      logOperation(db, 'orphans.delete', f, 'ok', 'ELIMINATO DEFINITIVAMENTE (scritture dirette)');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      failed.push({ path: f, error: msg });
      logOperation(db, 'orphans.delete', f, 'error', msg);
    }
  }
  return { deleted, freedBytes, failed };
}
