import type BetterSqlite3 from 'better-sqlite3';
import {
  compareSignals,
  nativeSignalFrom,
  signalFor,
  type ChangeSignal
} from './changeDetect';
import { readFormatData, type FormatNamespace } from './formatData';
import {
  diffTrack,
  policyFor,
  summarize,
  SYNC_FIELDS,
  type PlanSummary,
  type SideState,
  type SyncField,
  type SyncMode,
  type TrackPlan,
  type TrackState
} from './syncDiff';

/**
 * Motore di sincronizzazione fra librerie, esecuzione manuale.
 *
 * ⚠ DUE FASI SEPARATE, ed è la scelta di progetto più importante di questo
 * modulo.
 *
 *   A. RICONCILIAZIONE — qui. Accoppia i brani per identità canonica, calcola
 *      il piano e lo applica ALL'ARCHIVIO INTERNO. Nessun file di terze parti
 *      viene toccato: è un'operazione reversibile su un database che è nostro.
 *
 *   B. PROPAGAZIONE — non qui. La scrittura verso le librerie vere passa dagli
 *      export che già esistono, che hanno i loro gate, il rilevamento del
 *      processo, il blocco per versione e la catena di scrittura sicura.
 *
 * Perché non un pezzo solo. Un motore che riconcilia E scrive dovrebbe
 * duplicare sei percorsi di scrittura, ognuno con le proprie guardie, e ogni
 * duplicato è un posto in cui una guardia può mancare. Tenendole separate, la
 * fase che decide è dimostrabile con un test e la fase che scrive resta quella
 * già collaudata.
 *
 * Vedi `docs/architecture/SYNC.md`.
 */

/** Riga dell'archivio, limitata a ciò che serve al motore. */
interface TrackRow {
  id: number;
  source: string;
  canonical_id: number | null;
  data: string | null;
  title: string | null;
  artist: string | null;
  album: string | null;
  genre: string | null;
  year: number | null;
  bpm: number | null;
  musical_key: string | null;
  rating: number | null;
  track_color: string | null;
}

const COLUMN_OF: Record<SyncField, keyof TrackRow> = {
  title: 'title',
  artist: 'artist',
  album: 'album',
  genre: 'genre',
  year: 'year',
  bpm: 'bpm',
  musical_key: 'musical_key',
  rating: 'rating',
  track_color: 'track_color'
};

function toState(row: TrackRow, fields: SyncField[]): TrackState {
  const s: TrackState = {};
  for (const f of fields) s[f] = (row[COLUMN_OF[f]] as never) ?? null;
  return s;
}

/**
 * Momento dell'ultima modifica dichiarato dal software.
 *
 * ⚠ Solo quando è un NUMERO. Il segnale di Traktor è una stringa di formato non
 * documentato: serve a dire «è cambiato», non a dire «quando». Usarlo per
 * ordinare due modifiche nel tempo significherebbe confrontare due stringhe e
 * chiamarlo criterio temporale.
 */
function modifiedAtOf(row: TrackRow): number | null {
  const ns = row.source as FormatNamespace;
  const nativo = nativeSignalFrom(row.source, readFormatData(row.data, ns));
  return typeof nativo === 'number' ? nativo : null;
}

function signalOf(row: TrackRow, state: TrackState): ChangeSignal {
  const ns = row.source as FormatNamespace;
  return signalFor(row.source, state, nativeSignalFrom(row.source, readFormatData(row.data, ns)));
}

export interface SyncOptions {
  /** Valori di `tracks.source` del lato A. In master → slave, A è il master. */
  aSources: string[];
  bSources: string[];
  mode: SyncMode;
  /** Campi da sincronizzare. Vuoto = nessuno: il motore non sceglie da solo. */
  fields?: SyncField[];
  /**
   * Campi per cui è ammesso «vince il più recente». Solo quelli dove ENTRAMBI i
   * lati espongono un timestamp reale; il motore lo verifica comunque per
   * coppia, e dove manca dichiara un conflitto invece di inventare un criterio.
   */
  temporalFields?: SyncField[];
}

export interface PairPlan {
  canonicalId: number;
  aId: number;
  bId: number;
  aSoftware: string;
  bSoftware: string;
  plan: TrackPlan;
  /**
   * Verdetto del rilevamento delle modifiche, per lato. `unknown` significa
   * «non lo so», e non è un permesso: chi scrive deve guardare.
   */
  aChanged: 'changed' | 'unchanged' | 'unknown';
  bChanged: 'changed' | 'unchanged' | 'unknown';
}

export interface SyncPlanResult {
  pairs: PairPlan[];
  summary: PlanSummary;
  /**
   * Coppie in cui NESSUNO dei due lati risulta cambiato dall'ultimo
   * allineamento: si saltano, ed è il motivo per cui un secondo giro su una
   * libreria ferma non fa niente.
   */
  skipped: number;
  /** Brani presenti in un solo lato: non sono un conflitto, non c'è cosa allineare. */
  unpaired: number;
}

/**
 * Campi predefiniti.
 *
 * ⚠ Volutamente NON tutti. Chi ha ripulito i generi in un software raramente
 * vuole che quelli di un altro glieli sovrascrivano; e il titolo lo cambia chi
 * corregge un tag, non chi sincronizza. Il predefinito prudente è la parte
 * su cui i software concordano quasi sempre — e il resto lo si accende sapendo
 * cosa si sta accendendo.
 */
export const DEFAULT_SYNC_FIELDS: SyncField[] = ['bpm', 'musical_key', 'rating', 'track_color'];

/** Campi per cui il criterio temporale è ammissibile, dove i dati lo permettono. */
export const TEMPORAL_CANDIDATES: SyncField[] = ['genre', 'rating', 'track_color', 'year'];

/**
 * Calcola il piano. NON scrive niente: è la prova a vuoto che l'utente vede
 * prima di confermare, e la stessa struttura che `applySync` poi esegue.
 */
export function planLibrarySync(
  db: BetterSqlite3.Database,
  opts: SyncOptions
): SyncPlanResult {
  const fields = opts.fields ?? DEFAULT_SYNC_FIELDS;
  const policy = policyFor(opts.mode, { temporalFields: opts.temporalFields ?? [] });

  const q = (list: string[]) => list.map(() => '?').join(',');
  /* Colonne da leggere per ciascun lato, con un prefisso che le distingue: la
     stessa riga di risultato porta il brano di A e quello di B. */
  const PER_SIDE = ['id', 'source', 'canonical_id', 'data', ...SYNC_FIELDS.map((f) => COLUMN_OF[f])];
  const sideCols = (alias: 'a' | 'b') =>
    PER_SIDE.map((c) => `${alias}.${c} AS ${alias}_${c}`).join(', ');

  /* Le coppie che descrivono lo STESSO brano reale: è esattamente ciò per cui
     esiste l'identità canonica. `a.id <> b.id` esclude l'accoppiamento di una
     riga con se stessa, che il join altrimenti produrrebbe. */
  const pairs = db
    .prepare(
      `SELECT ${sideCols('a')}, ${sideCols('b')},
              COALESCE(a.canonical_id, a.id) AS canonical_id
         FROM tracks a
         JOIN tracks b
           ON COALESCE(b.canonical_id, b.id) = COALESCE(a.canonical_id, a.id)
        WHERE a.source IN (${q(opts.aSources)})
          AND b.source IN (${q(opts.bSources)})
          AND a.id <> b.id
        ORDER BY canonical_id, a.id, b.id`
    )
    .all(...opts.aSources, ...opts.bSources) as Record<string, unknown>[];

  const getState = db.prepare(
    `SELECT last_signal, last_synced_digest FROM sync_state
      WHERE canonical_id = ? AND software = ?`
  );

  const out: PairPlan[] = [];
  let skipped = 0;

  for (const p of pairs) {
    const a = pick(p, 'a_');
    const b = pick(p, 'b_');
    const canonicalId = Number(p.canonical_id);

    const aState = toState(a, fields);
    const bState = toState(b, fields);

    const aSignal = signalOf(a, aState);
    const bSignal = signalOf(b, bState);

    const aSaved = getState.get(canonicalId, a.source) as
      | { last_signal: string | null; last_synced_digest: string | null }
      | undefined;
    const bSaved = getState.get(canonicalId, b.source) as
      | { last_signal: string | null; last_synced_digest: string | null }
      | undefined;

    const aChanged = compareSignals(parseSignal(aSaved?.last_signal), aSignal);
    const bChanged = compareSignals(parseSignal(bSaved?.last_signal), bSignal);

    /* ⚠ Entrambi fermi dall'ultimo allineamento: non c'è niente da guardare.
       È la ragione per cui un secondo giro su una libreria che nessuno ha
       toccato non produce lavoro — senza, ogni giro rileggerebbe tutto. */
    if (aChanged === 'unchanged' && bChanged === 'unchanged') {
      skipped++;
      continue;
    }

    /* La base: lo stato all'ultimo allineamento riuscito. `undefined` significa
       «primo allineamento», e cambia il significato di ogni differenza. */
    const base = parseState(aSaved?.last_synced_digest ?? bSaved?.last_synced_digest);

    const sideA: SideState = { software: a.source, track: aState, modifiedAt: modifiedAtOf(a) };
    const sideB: SideState = { software: b.source, track: bState, modifiedAt: modifiedAtOf(b) };

    out.push({
      canonicalId,
      aId: a.id,
      bId: b.id,
      aSoftware: a.source,
      bSoftware: b.source,
      plan: diffTrack(base, sideA, sideB, policy),
      aChanged,
      bChanged
    });
  }

  /* Brani presenti in un solo lato. Non sono un conflitto e non sono un errore:
     è la condizione normale di due librerie che non contengono le stesse cose. */
  const unpaired = (
    db
      .prepare(
        `SELECT COUNT(*) c FROM tracks a
          WHERE a.source IN (${q(opts.aSources)})
            AND NOT EXISTS (
              SELECT 1 FROM tracks b
               WHERE b.source IN (${q(opts.bSources)})
                 AND COALESCE(b.canonical_id, b.id) = COALESCE(a.canonical_id, a.id)
                 AND b.id <> a.id)`
      )
      .get(...opts.aSources, ...opts.bSources) as { c: number }
  ).c;

  return {
    pairs: out,
    summary: summarize(out.map((x) => x.plan)),
    skipped,
    unpaired
  };
}

/** Estrae le colonne con un prefisso in una riga tipizzata. */
function pick(row: Record<string, unknown>, prefix: string): TrackRow {
  const o: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (k.startsWith(prefix)) o[k.slice(prefix.length)] = v;
  }
  return o as unknown as TrackRow;
}

function parseSignal(raw: string | null | undefined): ChangeSignal | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as ChangeSignal;
    return o && typeof o.kind === 'string' && typeof o.value === 'string' ? o : null;
  } catch {
    return null;
  }
}

function parseState(raw: string | null | undefined): TrackState | undefined {
  if (!raw) return undefined;
  try {
    const o = JSON.parse(raw) as TrackState;
    return o && typeof o === 'object' ? o : undefined;
  } catch {
    return undefined;
  }
}

export interface ApplyReport {
  /** Brani in cui almeno un campo è stato scritto. */
  written: number;
  fieldsToA: number;
  fieldsToB: number;
  /** Conflitti registrati e lasciati all'utente. */
  conflicts: number;
  /** Righe di `sync_state` aggiornate. */
  stateRows: number;
}

/**
 * Applica il piano ALL'ARCHIVIO INTERNO.
 *
 * ⚠ Non tocca nessuna libreria di terze parti: la propagazione verso i software
 * DJ passa dagli export, che hanno le loro guardie. Qui si allinea l'archivio,
 * e l'operazione è annullabile perché tutto ciò che cambia è in un database
 * nostro di cui esiste il backup.
 *
 * Tutto in UNA transazione: un allineamento a metà lascerebbe uno `sync_state`
 * che dichiara un allineamento mai avvenuto, ed è lo stato peggiore possibile —
 * il giro dopo crederebbe di partire da una base che non esiste.
 */
export function applySync(
  db: BetterSqlite3.Database,
  result: SyncPlanResult,
  opts: SyncOptions
): ApplyReport {
  const fields = opts.fields ?? DEFAULT_SYNC_FIELDS;
  const report: ApplyReport = {
    written: 0,
    fieldsToA: 0,
    fieldsToB: 0,
    conflicts: 0,
    stateRows: 0
  };

  const upsertState = db.prepare(
    `INSERT INTO sync_state (canonical_id, software, last_signal, last_synced_digest,
                             last_synced_at, outcome)
     VALUES (?, ?, ?, ?, datetime('now'), ?)
     ON CONFLICT(canonical_id, software) DO UPDATE SET
       last_signal = excluded.last_signal,
       last_synced_digest = excluded.last_synced_digest,
       last_synced_at = excluded.last_synced_at,
       outcome = excluded.outcome`
  );
  const insertConflict = db.prepare(
    `INSERT INTO sync_conflicts (canonical_id, field, a_software, a_value, b_software, b_value)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  const clearConflicts = db.prepare(
    `DELETE FROM sync_conflicts WHERE canonical_id = ? AND resolved_at IS NULL`
  );

  const run = db.transaction(() => {
    for (const pair of result.pairs) {
      const { plan } = pair;

      applyFields(db, pair.aId, plan.toA);
      applyFields(db, pair.bId, plan.toB);
      report.fieldsToA += Object.keys(plan.toA).length;
      report.fieldsToB += Object.keys(plan.toB).length;
      if (Object.keys(plan.toA).length + Object.keys(plan.toB).length > 0) report.written++;

      /* I conflitti aperti si sostituiscono, non si accumulano: la stessa
         coppia rivista due volte non deve produrre due righe che dicono la
         stessa cosa. Quelli già risolti dall'utente restano dove sono. */
      clearConflicts.run(pair.canonicalId);
      for (const c of plan.conflicts) {
        insertConflict.run(
          pair.canonicalId,
          c.field,
          pair.aSoftware,
          c.aValue === null ? null : String(c.aValue),
          pair.bSoftware,
          c.bValue === null ? null : String(c.bValue)
        );
        report.conflicts++;
      }

      /* Lo stato di riferimento si aggiorna SOLO sui campi che l'allineamento
         ha davvero portato allo stesso valore. Registrare come «allineato» un
         campo rimasto in conflitto significherebbe che il giro successivo non
         lo vedrebbe più come divergente. */
      const allineato = alignedState(db, pair.aId, pair.bId, fields, plan);
      const digest = JSON.stringify(allineato);
      const esito = plan.conflicts.length > 0 ? 'conflict' : 'ok';

      for (const [id, software] of [
        [pair.aId, pair.aSoftware],
        [pair.bId, pair.bSoftware]
      ] as [number, string][]) {
        const row = db
          .prepare(
            `SELECT id, source, canonical_id, data,
                    ${SYNC_FIELDS.map((f) => COLUMN_OF[f]).join(', ')}
               FROM tracks WHERE id = ?`
          )
          .get(id) as TrackRow;
        const signal = signalOf(row, toState(row, fields));
        upsertState.run(
          pair.canonicalId,
          software,
          JSON.stringify(signal),
          digest,
          esito
        );
        report.stateRows++;
      }
    }
  });

  run();
  return report;
}

function applyFields(db: BetterSqlite3.Database, trackId: number, values: TrackState): void {
  const entries = Object.entries(values) as [SyncField, unknown][];
  if (entries.length === 0) return;
  const set = entries.map(([f]) => `${COLUMN_OF[f]} = ?`).join(', ');
  db.prepare(`UPDATE tracks SET ${set} WHERE id = ?`).run(...entries.map(([, v]) => v), trackId);
}

/**
 * Stato che i due lati condividono DOPO l'allineamento: è ciò che diventerà la
 * base del giro successivo.
 *
 * I campi rimasti in conflitto vengono esclusi di proposito — vedi il commento
 * in `applySync`.
 */
function alignedState(
  db: BetterSqlite3.Database,
  aId: number,
  bId: number,
  fields: SyncField[],
  plan: TrackPlan
): TrackState {
  const inConflitto = new Set(plan.conflicts.map((c) => c.field));
  const a = db
    .prepare(
      `SELECT id, source, canonical_id, data, ${SYNC_FIELDS.map((f) => COLUMN_OF[f]).join(', ')}
         FROM tracks WHERE id = ?`
    )
    .get(aId) as TrackRow;
  const b = db
    .prepare(
      `SELECT id, source, canonical_id, data, ${SYNC_FIELDS.map((f) => COLUMN_OF[f]).join(', ')}
         FROM tracks WHERE id = ?`
    )
    .get(bId) as TrackRow;

  const out: TrackState = {};
  for (const f of fields) {
    if (inConflitto.has(f)) continue;
    const av = (a[COLUMN_OF[f]] as never) ?? null;
    const bv = (b[COLUMN_OF[f]] as never) ?? null;
    // Solo dove i due lati ora coincidono: altrimenti non è una base.
    if (String(av ?? '') === String(bv ?? '')) out[f] = av;
  }
  return out;
}
