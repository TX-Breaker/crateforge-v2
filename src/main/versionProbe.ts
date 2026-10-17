import Database from 'better-sqlite3';
import { existsSync, openSync, readSync, closeSync, statSync } from 'fs';
import { basename, dirname, join } from 'path';
import type { DjSoftware } from '@core/djVersions';

/**
 * Lettura del MARCATORE DI VERSIONE dalle librerie dei software DJ.
 *
 * Sonda deliberatamente minima: legge il minimo indispensabile (i primi
 * kilobyte di un XML, una riga di SQLite, il primo campo di un file binario) e
 * apre tutto in sola lettura. Serve a decidere se possiamo scrivere, quindi
 * deve costare poco e non poter fare danni: se qualcosa non va restituisce
 * null, e chi la usa tratta il null come "non collaudabile" — cioè si ferma —
 * invece di indovinare.
 */

/** Primi `n` byte di un file, senza caricarlo tutto in memoria. */
function head(path: string, n = 8192): string | null {
  let fd: number | null = null;
  try {
    fd = openSync(path, 'r');
    const buf = Buffer.alloc(n);
    const read = readSync(fd, buf, 0, n, 0);
    return buf.subarray(0, read).toString('utf-8');
  } catch {
    return null;
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        /* già chiuso */
      }
    }
  }
}

/** Engine DJ: Information.schemaVersionMajor/Minor/Patch dal m.db. */
export function probeEngine(dbPath: string): string | null {
  if (!existsSync(dbPath)) return null;
  let db: Database.Database | null = null;
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
    const row = db
      .prepare(
        `SELECT schemaVersionMajor AS a, schemaVersionMinor AS b, schemaVersionPatch AS c
         FROM Information LIMIT 1`
      )
      .get() as { a: number; b: number; c: number } | undefined;
    if (!row) return null;
    return `${row.a}.${row.b}.${row.c}`;
  } catch {
    return null;
  } finally {
    try {
      db?.close();
    } catch {
      /* niente da fare */
    }
  }
}

/**
 * Serato: campo `vrsn` in testa al file "database V2".
 * Struttura: [tag 4 char][uint32 BE lunghezza][payload UTF-16-BE].
 */
export function probeSerato(seratoDir: string): string | null {
  const dbFile = join(seratoDir, 'database V2');
  if (!existsSync(dbFile)) return null;
  let fd: number | null = null;
  try {
    fd = openSync(dbFile, 'r');
    const buf = Buffer.alloc(512);
    const read = readSync(fd, buf, 0, 512, 0);
    if (read < 8) return null;
    if (buf.subarray(0, 4).toString('ascii') !== 'vrsn') return null;
    const len = buf.readUInt32BE(4);
    if (len <= 0 || 8 + len > read) return null;
    return buf.subarray(8, 8 + len).swap16().toString('utf16le');
  } catch {
    return null;
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        /* già chiuso */
      }
    }
  }
}

/** Traktor: attributo VERSION dell'elemento NML, in testa al file. */
export function probeTraktor(nmlPath: string): string | null {
  const h = head(nmlPath);
  if (!h) return null;
  return h.match(/<NML[^>]*\bVERSION\s*=\s*"([^"]+)"/i)?.[1] ?? null;
}

/** VirtualDJ: attributo Version di VirtualDJ_Database. */
export function probeVirtualDj(xmlPath: string): string | null {
  const h = head(xmlPath);
  if (!h) return null;
  return h.match(/<VirtualDJ_Database[^>]*\bVersion\s*=\s*"([^"]+)"/i)?.[1] ?? null;
}

/**
 * Rekordbox, collection XML: DJ_PLAYLISTS@Version è la versione del FORMATO
 * (storicamente 1.0.0). PRODUCT@Version è la versione dell'app che l'ha
 * esportato: la restituiamo a parte perché è informativa, non normativa.
 */
export function probeRekordboxXml(xmlPath: string): { format: string | null; app: string | null } {
  const h = head(xmlPath);
  if (!h) return { format: null, app: null };
  return {
    format: h.match(/<DJ_PLAYLISTS[^>]*\bVersion\s*=\s*"([^"]+)"/i)?.[1] ?? null,
    app: h.match(/<PRODUCT[^>]*\bVersion\s*=\s*"([^"]+)"/i)?.[1] ?? null
  };
}

/**
 * Rekordbox, master.db: è cifrato, la versione dello schema non è leggibile da
 * qui. Quello che possiamo dire con certezza è la versione dell'APP installata,
 * che su Windows e macOS sta nel nome della cartella di installazione
 * ("rekordbox 7.2.16"). È un'approssimazione dichiarata: se il master.db arriva
 * da un altro computer, questo dato non lo descrive.
 */
/**
 * Versione di un'app macOS dal suo Info.plist (`CFBundleShortVersionString`).
 * Accetta la cartella che contiene l'app (`/Applications/rekordbox 7`) o
 * l'app stessa (`…/rekordbox.app`).
 */
export function macBundleVersion(dir: string): string | null {
  const { readdirSync, readFileSync } = require('fs') as typeof import('fs');
  try {
    const apps = dir.endsWith('.app') ? [dir] : readdirSync(dir).filter((n) => n.endsWith('.app')).map((n) => join(dir, n));
    for (const appDir of apps) {
      const plist = join(appDir, 'Contents', 'Info.plist');
      if (!existsSync(plist)) continue;
      const m = readFileSync(plist, 'utf-8').match(
        /<key>CFBundleShortVersionString<\/key>\s*<string>\s*(\d+(?:\.\d+)*)\s*<\/string>/
      );
      if (m) return m[1];
    }
  } catch {
    /* app illeggibile o plist binario: nessuna informazione */
  }
  return null;
}

export function probeRekordboxApp(): string | null {
  const roots =
    process.platform === 'win32'
      ? ['C:\\Program Files\\rekordbox', 'C:\\Program Files (x86)\\rekordbox']
      : ['/Applications'];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    try {
      const { readdirSync } = require('fs') as typeof import('fs');
      const versions = readdirSync(root)
        .map((name) => ({
          name,
          /* Su macOS la cartella si chiama «rekordbox 7»: la versione completa
             sta nel Info.plist dell'app. Senza, il controllo di versione
             vedeva «7» e non poteva confrontarlo con la versione collaudata. */
          v:
            (process.platform === 'darwin' && /^rekordbox/i.test(name) ? macBundleVersion(join(root, name)) : null) ??
            name.match(/rekordbox\s+(\d+(?:\.\d+)*)/i)?.[1] ??
            null
        }))
        .filter((x): x is { name: string; v: string } => x.v !== null)
        // Ordinamento NUMERICO: quello lessicale metterebbe 7.2.9 dopo 7.2.16.
        .sort((a, b) => {
          const pa = a.v.split('.').map(Number);
          const pb = b.v.split('.').map(Number);
          for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
            const d = (pb[i] ?? 0) - (pa[i] ?? 0);
            if (d !== 0) return d;
          }
          return 0;
        });
      if (versions.length) return versions[0].v;
    } catch {
      /* cartella non leggibile: nessuna informazione, non un errore */
    }
  }
  return null;
}

/**
 * Sonda per percorso: dato ciò che l'utente ha scelto, capisce quale software è
 * e ne legge il marcatore. `path` può essere un file (m.db, .nml, .xml) o una
 * cartella (_Serato_).
 */
export function probeVersion(software: DjSoftware, path: string): string | null {
  try {
    switch (software) {
      case 'engine':
        return probeEngine(path);
      case 'serato4':
        return probeSerato4(path);
      case 'serato': {
        // Accetta sia la cartella _Serato_ sia un percorso al suo interno.
        if (existsSync(join(path, 'database V2'))) return probeSerato(path);
        if (basename(path) === 'database V2') return probeSerato(dirname(path));
        return probeSerato(path);
      }
      case 'traktor':
        return probeTraktor(path);
      case 'virtualdj': {
        if (existsSync(path) && statSync(path).isDirectory()) {
          const db = join(path, 'database.xml');
          return existsSync(db) ? probeVirtualDj(db) : null;
        }
        return probeVirtualDj(path);
      }
      case 'rekordbox':
        return probeRekordboxXml(path).format;
    }
  } catch {
    return null;
  }
}

/**
 * Serato DJ Pro 4: `PRAGMA user_version` di `master.sqlite`.
 *
 * ⚠ È un marcatore di FORMATO, non di applicazione: la tabella
 * `migration_script` conserva la storia delle migrazioni, e ognuna finisce con
 * `PRAGMA user_version = N`. È quindi Serato stesso a dichiarare quale versione
 * di schema sta usando — esattamente ciò che serve al gate delle scritture.
 *
 * Si legge dall'intestazione del file invece di aprire una connessione SQLite:
 * `user_version` sta a offset 60 dei primi 100 byte di ogni database SQLite, in
 * big-endian. Così la sonda non prende lock su un database che Serato potrebbe
 * avere aperto.
 */
export function probeSerato4(masterSqlitePath: string): string | null {
  if (!existsSync(masterSqlitePath)) return null;
  let fd: number | null = null;
  try {
    fd = openSync(masterSqlitePath, 'r');
    const buf = Buffer.alloc(100);
    const read = readSync(fd, buf, 0, 100, 0);
    if (read < 100) return null;
    if (buf.subarray(0, 15).toString('ascii') !== 'SQLite format 3') return null;
    const version = buf.readUInt32BE(60);
    return version > 0 ? String(version) : null;
  } catch {
    return null;
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        /* già chiuso */
      }
    }
  }
}
