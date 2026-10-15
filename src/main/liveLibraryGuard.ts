import { existsSync } from 'fs';
import { basename, resolve } from 'path';

/**
 * Un export non deve mai finire SOPRA la libreria viva di un software DJ.
 *
 * ⚠ Gli export verso Traktor e VirtualDJ producono un file nuovo, che l'utente
 * importa da sé: il writer di Traktor lo dichiara nel suo commento ("nessun
 * tocco al collection.nml esistente"). Ma niente lo faceva rispettare. La
 * finestra di salvataggio permette di scegliere qualunque file, e scegliendo il
 * `collection.nml` vero lo si sovrascriveva con l'export: senza backup, senza
 * l'abilitazione delle scritture dirette, anche con Traktor aperto — che poi,
 * alla chiusura, lo riscrive con la sua copia in memoria. In ogni caso l'utente
 * perde qualcosa: tutto ciò che Traktor ha e il modello interno non porta, o
 * l'export stesso.
 *
 * Engine non ne ha bisogno: il suo writer rifiuta già una cartella che contiene
 * una libreria.
 */

/** Nome del file di libreria di ciascun software, quando è un file. */
const LIBRARY_FILE: Record<string, string> = {
  traktor: 'collection.nml',
  virtualdj: 'database.xml'
};

function same(a: string, b: string): boolean {
  const norm = (p: string) => {
    const r = resolve(p);
    return process.platform === 'win32' || process.platform === 'darwin' ? r.toLowerCase() : r;
  };
  return norm(a) === norm(b);
}

/**
 * La destinazione scelta è la libreria viva di `software`?
 *
 * Due criteri, perché uno solo non basta:
 *  - coincide con la libreria rilevata su questa macchina;
 *  - oppure ha il nome del file di libreria ed esiste già. Copre le
 *    installazioni che il rilevamento non vede (una versione di Traktor in una
 *    cartella diversa, un disco esterno), al costo di rifiutare un file con
 *    quel nome scelto apposta: l'utente sceglie un altro nome, e non perde
 *    niente.
 */
export function isLiveLibraryTarget(
  software: string,
  outPath: string,
  detectedPath: string | null | undefined
): boolean {
  if (detectedPath && same(outPath, detectedPath)) return true;
  const nome = LIBRARY_FILE[software];
  return !!nome && basename(outPath).toLowerCase() === nome && existsSync(outPath);
}

export function liveLibraryMessage(label: string): string {
  return (
    `Questo è il file della libreria di ${label}: l'export non lo sovrascrive. ` +
    `CrateForge scrive un file nuovo, che importi da ${label}. Scegli un altro nome.`
  );
}
