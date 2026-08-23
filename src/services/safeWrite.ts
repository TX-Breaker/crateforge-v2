import { closeSync, existsSync, fsyncSync, openSync, renameSync, rmSync, statSync } from 'fs';
import { copyFile, mkdir, rename, rm, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { hashFile, timestampDir } from './fsutil';

/**
 * Catena di scrittura sicura verso la libreria di un software DJ.
 *
 * ```
 * 1. BACKUP    copia verificata per hash dell'originale
 * 2. STAGING   il file nuovo si costruisce ALTROVE, per intero
 * 3. FSYNC     i dati arrivano sul disco, non restano in cache
 * 4. COPIA     dallo staging alla destinazione
 * 5. VERIFICA  si RILEGGE la destinazione e la si confronta
 * 6. ROLLBACK  su qualunque fallimento, ripristino dal backup e verifica
 * ```
 *
 * ⚠ Perché lo staging serve anche su disco locale, non solo su chiavetta.
 * Una sostituzione atomica è possibile soltanto se il file nuovo esiste già
 * intero: `rename` su un temporaneo completo non ha stati intermedi, mentre una
 * scrittura in loco ne ha uno per ogni byte — e un'interruzione lì lascia una
 * libreria mezza scritta, che è peggio di una non scritta.
 *
 * ⚠ Perché la verifica rilegge la DESTINAZIONE e non lo staging. Lo staging è
 * l'originale: è ovvio che sia corretto. È la copia che può essere troncata, ed
 * è così che le chiavette falliscono — dichiarando completata una scrittura che
 * non lo è.
 *
 * Vedi `docs/architecture/SYNC.md` §5.
 */

export interface SafeWriteOptions {
  /** File da sostituire. Può non esistere: in quel caso non c'è backup da fare. */
  target: string;
  /** Dove tenere la copia di sicurezza. Senza, la scrittura non parte. */
  backupDir: string;
  /**
   * Costruisce il contenuto nuovo. Riceve il percorso dello staging e ci
   * scrive dentro; non deve toccare `target`.
   *
   * ⚠ Riceve anche il percorso dell'ORIGINALE, perché quasi tutti i writer di
   * questo progetto devono rileggerlo per fondere invece di rigenerare.
   */
  build: (stagingPath: string, originalPath: string | null) => Promise<void>;
  /**
   * Controllo di sanità sul file appena costruito, prima di metterlo al posto
   * dell'originale. Restituire un messaggio significa «non sostituire».
   */
  validate?: (stagingPath: string) => Promise<string | null>;
  /** Nome del file dentro la cartella di backup. Default: quello del target. */
  backupName?: string;
}

export interface SafeWriteResult {
  ok: boolean;
  /** Percorso della copia di sicurezza, quando è stata fatta. */
  backupPath: string | null;
  /** Byte scritti nella destinazione. */
  bytes: number;
  /** true quando è stato necessario ripristinare. */
  rolledBack: boolean;
  message?: string;
}

/** `fsync` su un file: senza, i byte possono restare nella cache del sistema. */
function fsyncFile(path: string): void {
  const fd = openSync(path, 'r+');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

/**
 * `fsync` sulla DIRECTORY che contiene il file.
 *
 * ⚠ Su POSIX un `rename` non è durevole finché la directory non è stata
 * sincronizzata: dopo un'interruzione di corrente il file può risultare al
 * vecchio nome, o a nessuno dei due. Su Windows l'operazione non è disponibile
 * e il fallimento è previsto, non un errore.
 */
function fsyncDir(dir: string): void {
  try {
    const fd = openSync(dir, 'r');
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  } catch {
    // Windows non permette di aprire una directory: previsto.
  }
}

/**
 * Esegue la catena. Non solleva: l'esito sta nel risultato, perché il
 * chiamante deve poterlo mettere in un rapporto anche quando è andata male.
 */
export async function safeWrite(opts: SafeWriteOptions): Promise<SafeWriteResult> {
  const { target, backupDir, build, validate } = opts;
  const esisteva = existsSync(target);
  const staging = `${target}.cfnew`;

  let backupPath: string | null = null;
  let backupHash: string | null = null;

  /* --- 1. BACKUP ------------------------------------------------------- */
  if (esisteva) {
    try {
      await mkdir(backupDir, { recursive: true });
      backupPath = join(backupDir, opts.backupName ?? basenameOf(target));
      await copyFile(target, backupPath);
      backupHash = await hashFile(target);
      const copiaHash = await hashFile(backupPath);
      if (copiaHash !== backupHash) {
        await rm(backupPath, { force: true });
        return {
          ok: false,
          backupPath: null,
          bytes: 0,
          rolledBack: false,
          message:
            'Copia di sicurezza non verificata: la scrittura non è partita. ' +
            'Nessun file è stato modificato.'
        };
      }
    } catch (err) {
      return {
        ok: false,
        backupPath: null,
        bytes: 0,
        rolledBack: false,
        message: `Copia di sicurezza non riuscita (${String(err)}): nessuna scrittura eseguita.`
      };
    }
  }

  /* --- 2/3. STAGING + FSYNC -------------------------------------------- */
  try {
    await rm(staging, { force: true });
    await build(staging, esisteva ? target : null);
    if (!existsSync(staging)) {
      throw new Error('il costruttore non ha prodotto alcun file');
    }
    fsyncFile(staging);

    if (validate) {
      const problema = await validate(staging);
      if (problema) throw new Error(problema);
    }
  } catch (err) {
    await rm(staging, { force: true });
    /* L'originale non è mai stato toccato: non c'è niente da ripristinare, e
       dirlo esplicitamente evita all'utente di chiedersi in che stato sia. */
    return {
      ok: false,
      backupPath,
      bytes: 0,
      rolledBack: false,
      message: `Scrittura non riuscita (${String(err)}): l'originale non è stato modificato.`
    };
  }

  /* --- 4. COPIA (sostituzione atomica) --------------------------------- */
  try {
    await rename(staging, target);
    fsyncDir(dirname(target));
  } catch (err) {
    /* `rename` fallisce quando staging e destinazione stanno su filesystem
       diversi. Non è un caso teorico: la destinazione può essere una chiavetta.
       Si ripiega sulla copia, che non è atomica — ed è esattamente il momento in
       cui il backup serve. */
    try {
      await copyFile(staging, target);
      fsyncFile(target);
      await rm(staging, { force: true });
    } catch (err2) {
      await rm(staging, { force: true });
      const ripristinato = await restore(backupPath, target, backupHash);
      return {
        ok: false,
        backupPath,
        bytes: 0,
        rolledBack: ripristinato,
        message:
          `Copia nella destinazione non riuscita (${String(err2)}; primo tentativo: ${String(err)}). ` +
          (ripristinato
            ? 'L’originale è stato ripristinato dalla copia di sicurezza.'
            : '⚠ Ripristino NON riuscito: la copia di sicurezza è in ' + (backupPath ?? 'nessuna cartella'))
      };
    }
  }

  /* --- 5. VERIFICA ------------------------------------------------------ */
  try {
    const scritto = statSync(target);
    if (scritto.size === 0) throw new Error('il file scritto è vuoto');
    if (validate) {
      const problema = await validate(target);
      if (problema) throw new Error(problema);
    }
    return { ok: true, backupPath, bytes: scritto.size, rolledBack: false };
  } catch (err) {
    const ripristinato = await restore(backupPath, target, backupHash);
    return {
      ok: false,
      backupPath,
      bytes: 0,
      rolledBack: ripristinato,
      message:
        `Verifica della destinazione fallita (${String(err)}). ` +
        (ripristinato
          ? 'L’originale è stato ripristinato dalla copia di sicurezza.'
          : '⚠ Ripristino NON riuscito: la copia di sicurezza è in ' + (backupPath ?? 'nessuna cartella'))
    };
  }
}

/**
 * Ripristino, con verifica.
 *
 * ⚠ Un ripristino che non si verifica non è un ripristino: se la copia
 * ripristinata non torna all'hash di partenza, l'utente deve saperlo ADESSO —
 * mentre il backup è ancora lì — e non quando aprirà il software.
 */
async function restore(
  backupPath: string | null,
  target: string,
  expectedHash: string | null
): Promise<boolean> {
  if (!backupPath || !existsSync(backupPath)) return false;
  try {
    await copyFile(backupPath, target);
    if (expectedHash) {
      const dopo = await hashFile(target);
      if (dopo !== expectedHash) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function basenameOf(p: string): string {
  return p.split(/[/\\]/).pop() ?? 'file';
}

/**
 * Cartella di backup datata per un'operazione.
 *
 * Una cartella per operazione, non un file per volta: un giro di
 * sincronizzazione tocca più librerie, e ripristinarne una sola lascerebbe
 * l'insieme incoerente. Tenendole insieme, il ripristino è un'unica cartella da
 * copiare indietro.
 */
export function operationBackupDir(root: string, operation: string): string {
  return join(root, 'backups', `${operation}-${timestampDir()}`);
}

/**
 * Scrittura sicura di contenuto già pronto, per il caso semplice.
 *
 * ⚠ `writeFile` sullo staging e non sul bersaglio: è la stessa regola di sopra,
 * e la ragione per cui questa scorciatoia esiste è proprio che scriverla a mano
 * ogni volta porta prima o poi a saltarla.
 */
export async function safeWriteBuffer(
  target: string,
  backupDir: string,
  content: Buffer | string,
  validate?: (path: string) => Promise<string | null>
): Promise<SafeWriteResult> {
  return safeWrite({
    target,
    backupDir,
    validate,
    build: async (staging) => {
      await mkdir(dirname(staging), { recursive: true });
      await writeFile(staging, content);
    }
  });
}

/** Rimuove uno staging rimasto da un'esecuzione interrotta. */
export function cleanStaging(target: string): void {
  try {
    rmSync(`${target}.cfnew`, { force: true });
  } catch {
    /* niente da pulire */
  }
}

/** Sostituzione atomica sincrona, per i writer che già lavorano in sincrono. */
export function replaceAtomically(staging: string, target: string): void {
  fsyncFile(staging);
  renameSync(staging, target);
  fsyncDir(dirname(target));
}
