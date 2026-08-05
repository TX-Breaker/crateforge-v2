/**
 * Che cosa entra nel programma musicale e che cosa no.
 *
 * Due decisioni sole, ma sono le due che l'utente ci mette la faccia:
 *
 * 1) L'ORARIO. Una serata non sta dentro un giorno di calendario: comincia alle
 *    21:00 e finisce alle 06:00 del giorno DOPO. Un confronto ingenuo
 *    (`ora >= 21 && ora <= 6`) non è mai vero. Qui la finestra che passa la
 *    mezzanotte è il caso normale, non l'eccezione.
 *
 * 2) I SAMPLE. Jingle, stacchi, effetti e loop di due secondi non sono brani
 *    riprodotti: finiscono in un elenco che dovrebbe contenere opere. Sotto una
 *    durata si escludono — ma si CONTANO, e il numero finisce nel foglio.
 *
 * Il criterio è sempre lo stesso: dove non possiamo sapere, non buttiamo via.
 * Una riga senza orario resta dentro e viene contata a parte — un elenco per la
 * SIAE che perde brani in silenzio è peggio di un elenco con qualche riga in più.
 */

/** `21:00` → 1260. Restituisce null se non è un orario. */
export function minutesOfDay(hhmm: string | null | undefined): number | null {
  if (!hhmm) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/**
 * L'orario di un istante ISO, in minuti dalla mezzanotte.
 *
 * Il valore arriva da Rekordbox, che scrive l'ora LOCALE della macchina al
 * momento della riproduzione, senza fuso. Lo leggiamo con la stessa lettura —
 * i due numeri in fondo alla stringa — invece di passare da `Date`, che a un
 * `2026-08-05 23:40:12` senza `Z` applicherebbe il fuso della macchina che
 * apre il file, non di quella che ha suonato.
 */
export function minutesOfTimestamp(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const m = /(\d{1,2}):(\d{2})(?::\d{2})?/.exec(iso.replace(/^\d{4}-\d{2}-\d{2}/, ''));
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/**
 * L'istante sta nella finestra? La finestra che passa la mezzanotte
 * (21:00→06:00) è l'unione di due intervalli, non l'intersezione di uno.
 *
 * Estremi: inizio incluso, fine ESCLUSA. Con 21:00→06:00 un brano partito alle
 * 06:00 in punto appartiene alla mattina dopo, non alla serata — e due serate
 * consecutive non se lo contendono.
 */
export function inWindow(minutes: number, from: number, to: number): boolean {
  if (from === to) return true; // finestra di 24 ore: tutto dentro
  return from < to ? minutes >= from && minutes < to : minutes >= from || minutes < to;
}

export interface WindowFilterOptions {
  /** `21:00`; assente = nessun filtro sull'orario */
  fromTime?: string;
  /** `06:00`; assente = nessun filtro sull'orario */
  toTime?: string;
  /**
   * Durata sotto la quale un brano è considerato un sample e non entra
   * nell'elenco. 0 o assente = non escludere niente.
   */
  sampleUnderS?: number;
}

export interface FilterCounts {
  /** righe escluse perché fuori dalla finestra oraria */
  outOfWindow: number;
  /** righe escluse perché più corte della soglia */
  samples: number;
  /** righe tenute pur non avendo un orario: non potevamo giudicarle */
  unknownTime: number;
}

export interface FilterableRow {
  played_at?: string | null;
  duration_s?: number | null;
}

/**
 * Applica i due filtri e restituisce le righe rimaste con i conti di quelle
 * tolte. I conti servono a scriverli nel foglio: un elenco che dice «218 brani»
 * senza dire «12 sample esclusi» è un elenco che nasconde una decisione.
 */
export function filterSessionRows<T extends FilterableRow>(
  rows: T[],
  opts: WindowFilterOptions
): { rows: T[]; counts: FilterCounts } {
  const from = minutesOfDay(opts.fromTime);
  const to = minutesOfDay(opts.toTime);
  const useWindow = from !== null && to !== null;
  const threshold = opts.sampleUnderS && opts.sampleUnderS > 0 ? opts.sampleUnderS : 0;

  const counts: FilterCounts = { outOfWindow: 0, samples: 0, unknownTime: 0 };
  const kept: T[] = [];

  for (const r of rows) {
    /* Il sample si riconosce dalla durata del BRANO, non da quanto è stato
       suonato: un pezzo intero mandato per dieci secondi resta un pezzo. */
    if (threshold > 0 && r.duration_s != null && r.duration_s > 0 && r.duration_s < threshold) {
      counts.samples++;
      continue;
    }
    if (useWindow) {
      const at = minutesOfTimestamp(r.played_at);
      if (at === null) {
        // Nessun orario: non possiamo escluderla, quindi resta — e si dichiara.
        counts.unknownTime++;
        kept.push(r);
        continue;
      }
      if (!inWindow(at, from, to)) {
        counts.outOfWindow++;
        continue;
      }
    }
    kept.push(r);
  }

  return { rows: kept, counts };
}
