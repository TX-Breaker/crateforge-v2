import { execFileSync } from 'child_process';

/**
 * Rilevazione dei percorsi su UNITÀ DI RETE (§ diagnosi librerie).
 *
 * Perché serve: i database delle librerie DJ sono SQLite, e SQLite ha bisogno
 * di lock a livello di file che i filesystem di rete (SMB/NFS) non forniscono
 * in modo affidabile. Su una share si ottiene il classico "unable to open
 * database file" ANCHE quando i permessi di scrittura ci sono — verificato su
 * questa macchina: creare un file va, aprire un SQLite no.
 *
 * È esattamente ciò che fa fallire Engine DJ quando la cartella Music è
 * redirezionata su un NAS ("Your Music folder can't be accessed"), ed è la
 * stessa trappola in cui cadrebbe chi punta CrateForge a una libreria di rete:
 * meglio dirlo prima, con parole chiare, che lasciare un errore criptico.
 */

/** Percorso UNC esplicito: \\server\share\… (o //server/share). */
export function isUncPath(p: string): boolean {
  return /^(\\\\|\/\/)[^\\/]+[\\/]+[^\\/]+/.test(p);
}

/**
 * Lettere di unità mappate a share di rete su Windows.
 *
 * Le unità mappate sono elencate sotto HKCU\Network\<lettera>: la chiave esiste
 * SOLO per i drive di rete, quindi è un test affidabile e istantaneo (nessuna
 * query WMI, nessun timeout se il server non risponde).
 */
function mappedNetworkDrives(): Set<string> {
  const out = new Set<string>();
  if (process.platform !== 'win32') return out;
  try {
    const stdout = execFileSync('reg', ['query', 'HKCU\\Network'], {
      encoding: 'utf-8',
      timeout: 4000,
      windowsHide: true
    });
    for (const line of stdout.split('\n')) {
      const m = line.trim().match(/\\Network\\([A-Za-z])\s*$/);
      if (m) out.add(m[1].toUpperCase());
    }
  } catch {
    // Nessuna unità mappata (la chiave non esiste) o reg non disponibile:
    // restiamo sul solo test UNC, che copre il caso più comune.
  }
  return out;
}

// La mappa cambia raramente; la rileggiamo al più una volta ogni 30 secondi
// per non pagare un processo esterno a ogni file selezionato.
let cached: { at: number; drives: Set<string> } | null = null;
function networkDrives(): Set<string> {
  const now = Date.now();
  if (!cached || now - cached.at > 30_000) {
    cached = { at: now, drives: mappedNetworkDrives() };
  }
  return cached.drives;
}

/** true se il percorso vive su una share di rete (UNC o unità mappata). */
export function isNetworkPath(p: string): boolean {
  if (!p) return false;
  if (isUncPath(p)) return true;
  const drive = p.match(/^([A-Za-z]):/);
  return drive ? networkDrives().has(drive[1].toUpperCase()) : false;
}

/**
 * Avviso da mostrare quando una libreria sta su unità di rete. Ritorna null se
 * il percorso è locale (nessun rumore inutile).
 */
export function networkPathWarning(p: string): string | null {
  if (!isNetworkPath(p)) return null;
  return (
    'Questa libreria si trova su un\'unità di rete (NAS o cartella condivisa). ' +
    'I database delle librerie DJ sono SQLite, che su rete non riesce a bloccare i file ' +
    'in modo affidabile: la lettura può fallire con "impossibile aprire il database" anche ' +
    'quando i permessi sono corretti. Se hai problemi, copia la libreria su un disco locale ' +
    'e riprova da lì. (È lo stesso motivo per cui Engine DJ rifiuta una cartella Musica su NAS.)'
  );
}
