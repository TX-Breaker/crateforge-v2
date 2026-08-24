import type BetterSqlite3 from 'better-sqlite3';
import { basename } from 'path';
import { canonicalizeName, canonicalizePath } from '@services/fsutil';

/**
 * Identità di una traccia FRA software diversi.
 *
 * Il problema che risolve: lo stesso file MP3 importato da Rekordbox e da
 * Traktor arriva nell'UDM come due righe, perché l'identità di ingestione è
 * `(source, source_id)` e i due software non condividono nessun identificatore.
 * Finché ogni libreria si guarda da sola non dà fastidio. Nel momento in cui
 * l'utente chiede «mostrami tutto insieme», la stessa canzone compare due
 * volte; e nel momento in cui chiede «porta i cue da qui a lì», non c'è modo di
 * sapere quale riga corrisponde a quale.
 *
 * La regola, in ordine di certezza decrescente. Si ferma alla prima che
 * risponde, e ogni gradino è più debole del precedente:
 *
 *  1. STESSO PERCORSO, canonicalizzato (NFC + maiuscole/minuscole). È una
 *     certezza: due righe che puntano allo stesso file sullo stesso disco SONO
 *     lo stesso brano. Copre il caso normale, cioè due software che leggono la
 *     stessa cartella musicale.
 *  2. STESSO NOME FILE + DURATA a meno di un secondo + DIMENSIONE simile.
 *     Serve quando i percorsi divergono ma il file è lo stesso — libreria su
 *     lettera di unità diversa, cartella spostata, o un software che ha in
 *     archivio un percorso vecchio.
 *
 *     ⚠ La dimensione si confronta con TOLLERANZA, non al byte. La versione
 *     precedente la pretendeva identica, e su librerie vere non combaciava
 *     quasi mai: per lo stesso file di 8.062.629 byte, Rekordbox dichiarava
 *     7.968.831, Traktor 7.972.864, Engine 7.973.026 e solo VirtualDJ il valore
 *     giusto. Ognuno conserva la dimensione del momento in cui l'ha importato,
 *     e ogni riscrittura dei tag ID3 la sposta di qualche kilobyte. Preteserla
 *     esatta significava che la regola 2 non scattava mai fra software diversi,
 *     cioè proprio nel caso per cui esiste.
 *  3. STESSA IMPRONTA ACUSTICA. È l'unica che sopravvive a una ricodifica, ma
 *     esiste solo dove qualcuno l'ha calcolata: il fingerprint di CrateForge, o
 *     l'AudioSig che VirtualDJ regala nel proprio database.
 *
 * Quello che NON si fa: unire per titolo e artista. Due master diversi dello
 * stesso brano, un remix e la sua radio edit, la stessa traccia in due
 * compilation — hanno gli stessi tag e non sono lo stesso file. Un'unione
 * sbagliata qui significa cue scritti sul brano sbagliato, ed è esattamente il
 * tipo di errore che l'utente scopre sul palco.
 *
 * Nessuna riga viene mai cancellata o riscritta: l'unione è un puntatore
 * (`canonical_id`), quindi è sempre annullabile.
 */

export interface LinkResult {
  /** righe che hanno trovato un canonico diverso da sé */
  linked: number;
  /** gruppi con più di una sorgente, cioè brani presenti in più software */
  shared: number;
  /** quante unioni per ciascuna regola: utile per capire su cosa ci si è basati */
  byRule: { path: number; fileMatch: number; acoustic: number };
}

interface Row {
  id: number;
  source: string;
  path: string | null;
  filesize: number | null;
  duration_s: number | null;
  acoustic_id: string | null;
  canonical_id: number | null;
}

/**
 * Chiave della regola 2: il solo nome file canonicalizzato.
 *
 * ⚠ Né la durata né la dimensione entrano nella chiave: si verificano dopo,
 * con tolleranza. Un valore che va confrontato con tolleranza non può stare in
 * una chiave, perché la chiave è un confronto esatto per costruzione — due
 * letture dello stesso file finirebbero in secchi diversi e non si
 * incontrerebbero mai. La chiave serve a restringere i candidati; a decidere
 * sono i controlli.
 */
function fileKey(r: Row): string | null {
  if (!r.path) return null;
  if (r.duration_s === null || r.duration_s <= 0) return null;
  return canonicalizeName(basename(r.path));
}

/** Scarto ammesso fra due letture della stessa durata, in secondi. */
const DURATION_TOLERANCE_S = 1;

/**
 * Scarto RELATIVO ammesso fra due dimensioni dichiarate per lo stesso file.
 *
 * Il 5% è largo abbastanza per i tag — su una libreria reale lo scarto massimo
 * osservato è stato l'1,2%, dovuto a copertine e ID3 riscritti — e stretto
 * abbastanza da non confondere due qualità diverse dello stesso brano, che
 * differiscono di almeno il doppio.
 */
const FILESIZE_TOLERANCE = 0.05;

/**
 * Due dimensioni descrivono plausibilmente lo stesso file?
 *
 * Se una delle due manca la risposta è sì: l'assenza non è una smentita, e a
 * decidere restano nome e durata. È il caso di Serato ≤ 3, che non espone la
 * dimensione per nessuna traccia.
 */
function dimensioniCompatibili(a: number | null, b: number | null): boolean {
  if (a === null || b === null || a <= 0 || b <= 0) return true;
  return Math.abs(a - b) / Math.max(a, b) <= FILESIZE_TOLERANCE;
}

/**
 * Collega fra loro le righe che descrivono lo stesso file.
 *
 * Va richiamata dopo ogni import. È idempotente: rieseguirla non cambia nulla
 * se non ci sono righe nuove.
 *
 * Il canonico di un gruppo è la riga con l'id più basso — cioè la prima
 * importata. È una scelta arbitraria ma STABILE: senza una regola fissa, due
 * esecuzioni potrebbero eleggere canonici diversi e far ballare l'elenco
 * unificato sotto gli occhi dell'utente.
 */
export function linkCanonicalTracks(db: BetterSqlite3.Database): LinkResult {
  const result: LinkResult = { linked: 0, shared: 0, byRule: { path: 0, fileMatch: 0, acoustic: 0 } };

  /* Indici in memoria delle sole chiavi, non delle righe: su una libreria da
     100.000 brani sono pochi MB, contro l'intera tabella che la regola del
     progetto vieta di materializzare. */
  const byPath = new Map<string, number>();
  /** nome file → id, durata e dimensione del primo che l'ha occupata */
  const byFile = new Map<string, { id: number; duration: number; filesize: number | null }>();
  const byAcoustic = new Map<string, number>();
  /** id → canonico corrente, per non rileggere il DB dentro il ciclo */
  const canonicalOf = new Map<number, number>();

  const rows = db
    .prepare(
      `SELECT id, source, path, filesize, duration_s, acoustic_id, canonical_id
       FROM tracks ORDER BY id`
    )
    .iterate() as IterableIterator<Row>;

  /* Verdetti manuali dell'utente. Hanno la precedenza su OGNI regola: se una
     persona ha guardato due righe e ha detto «sono brani diversi», nessuna
     euristica la smentisce. È il motivo per cui esistono — la regola 2 può
     sbagliare, e prima che un motore automatico ci scriva sopra l'utente deve
     poter correggere. */
  const forced = new Map<string, 'same' | 'different'>();
  const pairKey = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);
  try {
    for (const o of db
      .prepare(`SELECT a_id, b_id, verdict FROM identity_overrides`)
      .all() as { a_id: number; b_id: number; verdict: 'same' | 'different' }[]) {
      forced.set(pairKey(o.a_id, o.b_id), o.verdict);
    }
  } catch {
    // Tabella assente su un database non ancora migrato: nessun verdetto.
  }

  const updates: { id: number; canonical: number; rule: string }[] = [];

  for (const r of rows) {
    const mine = r.canonical_id ?? r.id;
    canonicalOf.set(r.id, mine);

    const pathKey = r.path ? canonicalizePath(r.path) : null;
    const fk = fileKey(r);

    /* Le tre regole in ordine di certezza: ci si ferma alla prima che risponde,
       e ogni gradino sotto è più debole di quello sopra. */
    let target: number | null = null;
    let usedRule: keyof LinkResult['byRule'] | null = null;

    /** Una coppia che l'utente ha dichiarato diversa non si unisce mai. */
    const vietata = (other: number) => forced.get(pairKey(r.id, other)) === 'different';

    const hitPath = pathKey ? byPath.get(pathKey) : undefined;
    if (hitPath !== undefined && hitPath !== mine && !vietata(hitPath)) {
      target = canonicalOf.get(hitPath) ?? hitPath;
      usedRule = 'path';
    }

    if (target === null && fk) {
      const hit = byFile.get(fk);
      /* Durata e dimensione si CONFRONTANO qui, con tolleranza: vedi
         `fileKey()`. Entrambe devono reggere — il nome file da solo non basta,
         `track01.mp3` esiste in mille cartelle. */
      if (
        hit &&
        hit.id !== mine &&
        !vietata(hit.id) &&
        Math.abs(hit.duration - (r.duration_s ?? 0)) <= DURATION_TOLERANCE_S &&
        dimensioniCompatibili(hit.filesize, r.filesize)
      ) {
        target = canonicalOf.get(hit.id) ?? hit.id;
        usedRule = 'fileMatch';
      }
    }

    if (target === null && r.acoustic_id) {
      const hit = byAcoustic.get(r.acoustic_id);
      if (hit !== undefined && hit !== mine && !vietata(hit)) {
        target = canonicalOf.get(hit) ?? hit;
        usedRule = 'acoustic';
      }
    }

    if (target !== null && target !== mine) {
      // Il canonico è sempre l'id più basso del gruppo: stabile fra esecuzioni.
      const canonical = Math.min(target, mine);
      if (canonical !== mine) {
        /* La regola che ha collegato la riga viaggia con la riga. Serve a due
           cose diverse: dire all'utente PERCHE' due brani sono lo stesso, e
           permettere al motore di sincronizzazione di distinguere un
           collegamento certo da uno probabile — la fiducia in un accoppiamento
           per impronta acustica non e' quella di uno per percorso identico. */
        updates.push({ id: r.id, canonical, rule: usedRule ?? 'unknown' });
        canonicalOf.set(r.id, canonical);
        result.linked++;
        if (usedRule) result.byRule[usedRule]++;
      }
    }

    // Registra le chiavi di questa riga puntando al proprio canonico corrente.
    const now = canonicalOf.get(r.id)!;
    if (pathKey && !byPath.has(pathKey)) byPath.set(pathKey, now);
    if (fk && !byFile.has(fk))
      byFile.set(fk, { id: now, duration: r.duration_s ?? 0, filesize: r.filesize });
    if (r.acoustic_id && !byAcoustic.has(r.acoustic_id)) byAcoustic.set(r.acoustic_id, now);
  }

  if (updates.length) {
    const stmt = db.prepare(
      `UPDATE tracks SET canonical_id = ?, identity_rule = ?, identity_at = datetime('now')
        WHERE id = ?`
    );
    const run = db.transaction(() => {
      for (const u of updates) stmt.run(u.canonical, u.rule, u.id);
    });
    run();
  }

  result.shared = (
    db
      .prepare(
        `SELECT COUNT(*) c FROM (
           SELECT COALESCE(canonical_id, id) k FROM tracks
           GROUP BY k HAVING COUNT(DISTINCT source) > 1
         )`
      )
      .get() as { c: number }
  ).c;

  return result;
}

/**
 * Quante sorgenti descrivono ciascun canonico. Serve all'elenco unificato per
 * dire «questo brano ce l'hai in tre software» invece di mostrarlo tre volte.
 */
export function sourcesPerCanonical(
  db: BetterSqlite3.Database,
  canonicalId: number
): string[] {
  return (
    db
      .prepare(
        `SELECT DISTINCT source FROM tracks
         WHERE COALESCE(canonical_id, id) = ? ORDER BY source`
      )
      .all(canonicalId) as { source: string }[]
  ).map((r) => r.source);
}
