/**
 * Motore di diff a tre vie fra due librerie.
 *
 * ⚠ FUNZIONE PURA: nessun database, nessun file, nessuna data di sistema.
 * Riceve tre stati e restituisce un piano. È la scelta che rende dimostrabile
 * con un test ciò che altrimenti si potrebbe provare solo su una libreria vera
 * — e le librerie vere, per definizione, sono quelle che non ci si può
 * permettere di rompere.
 *
 * LE TRE VIE. Confrontare A con B dice che sono diversi; non dice CHI ha
 * cambiato. Serve la `base`: lo stato all'ultimo allineamento riuscito. Senza,
 * ogni differenza sembra un conflitto e l'utente annega in domande a cui non sa
 * rispondere.
 *
 *   base assente → prima sincronizzazione: nessun conflitto è possibile,
 *                  perché non c'è un «prima» rispetto a cui divergere.
 *   solo A ≠ base → modifica di A, da propagare.
 *   solo B ≠ base → modifica di B, da propagare.
 *   entrambi ≠ base e A ≠ B → conflitto vero.
 *   entrambi ≠ base e A = B → hanno cambiato allo stesso modo: niente da fare.
 *
 * Vedi `docs/architecture/SYNC.md` §3.
 */

/** I campi che il motore governa, raggruppati per come si risolvono. */
export type SyncField =
  | 'title'
  | 'artist'
  | 'album'
  | 'genre'
  | 'year'
  | 'bpm'
  | 'musical_key'
  | 'rating'
  | 'track_color';

export type FieldValue = string | number | null;

/** Stato di un brano in una libreria, limitato ai campi sincronizzabili. */
export type TrackState = Partial<Record<SyncField, FieldValue>>;

/**
 * Strategia di risoluzione. Le prime tre sono quelle di riferimento; la quarta
 * è ciò che serve in modalità master → slave.
 */
export type Strategy =
  /** Non fa niente e lo dice. È il predefinito ovunque ci sia ambiguità. */
  | 'noChange'
  /** Vince sempre il lato A. In master → slave, A è il master. */
  | 'preferA'
  | 'preferB'
  /** ⚠ Ammessa SOLO dove entrambi i lati espongono un timestamp reale. */
  | 'mostRecent';

export interface SideState {
  software: string;
  track: TrackState;
  /**
   * Momento dell'ultima modifica dichiarato dal software stesso, in
   * millisecondi. `null` quando quel formato non lo espone.
   *
   * ⚠ NON è la data del file. La data del file direbbe «ho ri-taggato l'MP3 la
   * settimana scorsa per altro, quindi i suoi valori vincono»: arbitrio
   * travestito da criterio. Qui ci va solo un timestamp che il software
   * mantiene per la traccia — `updated_at` di Rekordbox, `time_modified` di
   * Serato 4, `lastEditTime` di Engine.
   */
  modifiedAt: number | null;
}

export interface FieldDecision {
  field: SyncField;
  /** Chi vince, o perché non si fa niente. */
  outcome:
    | 'propagateToB'
    | 'propagateToA'
    | 'conflict'
    /** Cambiati entrambi, ma allo stesso modo. */
    | 'converged'
    /** Nessuno ha cambiato, oppure la strategia ha deciso di non toccare. */
    | 'unchanged';
  aValue: FieldValue;
  bValue: FieldValue;
  /** Valore che finirebbe nella destinazione, quando c'è una propagazione. */
  resolved?: FieldValue;
  /**
   * Perché è andata così. Non è decorazione: è ciò che il rapporto mostra
   * all'utente quando chiede conto di una scrittura.
   */
  reason: string;
}

export interface TrackPlan {
  decisions: FieldDecision[];
  toA: TrackState;
  toB: TrackState;
  conflicts: FieldDecision[];
  /** true quando non c'è niente da scrivere da nessuna parte. */
  noop: boolean;
}

/** Politica per campo. Un campo assente eredita `fallback`. */
export interface Policy {
  byField?: Partial<Record<SyncField, Strategy>>;
  fallback: Strategy;
}

/** Ordine stabile: il piano di due esecuzioni identiche deve coincidere. */
export const SYNC_FIELDS: SyncField[] = [
  'title',
  'artist',
  'album',
  'genre',
  'year',
  'bpm',
  'musical_key',
  'rating',
  'track_color'
];

/**
 * Confronto dei valori.
 *
 * ⚠ Le stringhe si confrontano dopo `trim`, e `null` equivale a stringa vuota:
 * fra un software che scrive `''` e uno che scrive `NULL` non c'è una
 * differenza che l'utente riconoscerebbe come tale, e trattarla come modifica
 * produrrebbe una riscrittura infinita a ogni giro.
 *
 * I numeri si confrontano con una tolleranza relativa: un BPM salvato come
 * 128.00001 da un software e 128 da un altro è lo stesso BPM.
 */
const BPM_TOLERANCE = 0.005;

export function sameValue(a: FieldValue, b: FieldValue): boolean {
  if (typeof a === 'number' && typeof b === 'number') {
    return Math.abs(a - b) <= BPM_TOLERANCE;
  }
  const na = a === null || a === undefined ? '' : String(a).trim();
  const nb = b === null || b === undefined ? '' : String(b).trim();
  return na === nb;
}

/**
 * ⚠ Un valore vuoto non sovrascrive mai un valore pieno.
 *
 * È la regola che evita il danno più comune di una sincronizzazione: una
 * libreria appena importata, con metà campi non ancora compilati, che cancella
 * il lavoro fatto nell'altra. «Non lo so» non è un'informazione da propagare.
 */
function isEmpty(v: FieldValue): boolean {
  return v === null || v === undefined || String(v).trim() === '';
}

function strategyFor(field: SyncField, policy: Policy): Strategy {
  return policy.byField?.[field] ?? policy.fallback;
}

/**
 * Risolve UN campo. Il cuore del motore.
 */
function decideField(
  field: SyncField,
  base: FieldValue | undefined,
  a: SideState,
  b: SideState,
  policy: Policy
): FieldDecision {
  const av = a.track[field] ?? null;
  const bv = b.track[field] ?? null;
  const mk = (
    outcome: FieldDecision['outcome'],
    reason: string,
    resolved?: FieldValue
  ): FieldDecision => ({ field, outcome, aValue: av, bValue: bv, resolved, reason });

  if (sameValue(av, bv)) return mk('unchanged', 'i due lati concordano');

  /* Prima sincronizzazione: non esiste un «prima» rispetto a cui divergere,
     quindi non esiste conflitto. Vince chi ha qualcosa da dire. */
  if (base === undefined) {
    if (isEmpty(av)) return mk('propagateToA', 'primo allineamento: A non ha un valore', bv);
    if (isEmpty(bv)) return mk('propagateToB', 'primo allineamento: B non ha un valore', av);
    return resolveConflict(field, a, b, policy, mk);
  }

  const aChanged = !sameValue(av, base);
  const bChanged = !sameValue(bv, base);

  if (!aChanged && !bChanged) return mk('unchanged', 'nessuno dei due ha cambiato');

  if (aChanged && !bChanged) {
    if (isEmpty(av)) {
      // A ha SVUOTATO il campo. È una modifica legittima, ma non si propaga:
      // svuotare per errore è facile, e la cancellazione a distanza è il danno
      // che una sincronizzazione non deve poter fare da sola.
      return mk('conflict', 'A ha svuotato il campo: va confermato a mano');
    }
    return mk('propagateToB', 'ha cambiato solo A', av);
  }

  if (bChanged && !aChanged) {
    if (isEmpty(bv)) return mk('conflict', 'B ha svuotato il campo: va confermato a mano');
    return mk('propagateToA', 'ha cambiato solo B', bv);
  }

  // Cambiati entrambi. Se sono arrivati allo stesso valore, non c'è nulla da fare.
  return resolveConflict(field, a, b, policy, mk);
}

function resolveConflict(
  field: SyncField,
  a: SideState,
  b: SideState,
  policy: Policy,
  mk: (o: FieldDecision['outcome'], r: string, v?: FieldValue) => FieldDecision
): FieldDecision {
  const av = a.track[field] ?? null;
  const bv = b.track[field] ?? null;
  const strategy = strategyFor(field, policy);

  switch (strategy) {
    case 'preferA':
      if (isEmpty(av)) return mk('unchanged', 'A vincerebbe ma non ha un valore');
      return mk('propagateToB', `vince ${a.software} per scelta dell'utente`, av);

    case 'preferB':
      if (isEmpty(bv)) return mk('unchanged', 'B vincerebbe ma non ha un valore');
      return mk('propagateToA', `vince ${b.software} per scelta dell'utente`, bv);

    case 'mostRecent': {
      /* ⚠ Ammessa solo se ENTRAMBI espongono una data vera. Se una manca, il
         confronto sarebbe fra un dato e un'assenza, e vincerebbe sempre lo
         stesso lato per un motivo che non ha niente a che vedere con quando
         l'utente ha lavorato. Meglio dichiarare il conflitto. */
      if (a.modifiedAt === null || b.modifiedAt === null) {
        return mk(
          'conflict',
          'nessun criterio temporale: uno dei due software non dichiara quando ha modificato'
        );
      }
      if (a.modifiedAt === b.modifiedAt) {
        return mk('conflict', 'stesso istante di modifica: non c’è un più recente');
      }
      const aVince = a.modifiedAt > b.modifiedAt;
      const vincitore = aVince ? av : bv;
      if (isEmpty(vincitore)) {
        return mk('conflict', 'il lato più recente ha svuotato il campo');
      }
      return aVince
        ? mk('propagateToB', `${a.software} ha modificato più di recente`, av)
        : mk('propagateToA', `${b.software} ha modificato più di recente`, bv);
    }

    case 'noChange':
    default:
      return mk('conflict', 'entrambi hanno cambiato: decide l’utente');
  }
}

/**
 * Piano per UN brano.
 *
 * `base` è lo stato all'ultimo allineamento riuscito. Passare `undefined`
 * significa «primo allineamento», e cambia il significato di ogni differenza.
 */
export function diffTrack(
  base: TrackState | undefined,
  a: SideState,
  b: SideState,
  policy: Policy
): TrackPlan {
  const decisions: FieldDecision[] = [];
  const toA: TrackState = {};
  const toB: TrackState = {};

  for (const field of SYNC_FIELDS) {
    // Un campo che nessuno dei due lati conosce non entra nel piano: quel
    // software semplicemente non ha quel concetto, e non è una differenza.
    if (!(field in a.track) && !(field in b.track)) continue;

    const d = decideField(field, base?.[field], a, b, policy);
    decisions.push(d);
    if (d.outcome === 'propagateToB' && d.resolved !== undefined) toB[field] = d.resolved;
    if (d.outcome === 'propagateToA' && d.resolved !== undefined) toA[field] = d.resolved;
  }

  const conflicts = decisions.filter((d) => d.outcome === 'conflict');
  return {
    decisions,
    toA,
    toB,
    conflicts,
    noop: Object.keys(toA).length === 0 && Object.keys(toB).length === 0 && conflicts.length === 0
  };
}

/* -------------------------------------------------------------- modalità */

export type SyncMode = 'symmetric' | 'masterSlave';

/**
 * Politica derivata dalla modalità.
 *
 * ⚠ In `masterSlave` la politica è `preferA` su TUTTO, con A = master. Non
 * perché il master abbia ragione in astratto, ma perché è ciò che l'utente ha
 * dichiarato designandolo: ha nominato lui il padrone.
 *
 * ⚠ In `symmetric` il predefinito è `noChange`. Un motore che risolve da solo
 * un conflitto simmetrico sta scegliendo al posto dell'utente su un dato che
 * l'utente ha toccato due volte, in due posti diversi, di proposito.
 */
export function policyFor(
  mode: SyncMode,
  opts?: { temporalFields?: SyncField[] }
): Policy {
  if (mode === 'masterSlave') return { fallback: 'preferA' };

  const byField: Partial<Record<SyncField, Strategy>> = {};
  for (const f of opts?.temporalFields ?? []) byField[f] = 'mostRecent';
  return { byField, fallback: 'noChange' };
}

/* ---------------------------------------------------------------- riepilogo */

export interface PlanSummary {
  tracks: number;
  /** brani con almeno una modifica da scrivere */
  touched: number;
  toA: number;
  toB: number;
  conflicts: number;
  /** brani in cui non c'è niente da fare */
  untouched: number;
}

/**
 * Riepilogo di un insieme di piani: è il numero che l'utente vede PRIMA di
 * confermare. Una scrittura si autorizza sapendo quanto costa, non dopo.
 */
export function summarize(plans: TrackPlan[]): PlanSummary {
  const s: PlanSummary = { tracks: plans.length, touched: 0, toA: 0, toB: 0, conflicts: 0, untouched: 0 };
  for (const p of plans) {
    const a = Object.keys(p.toA).length;
    const b = Object.keys(p.toB).length;
    s.toA += a;
    s.toB += b;
    s.conflicts += p.conflicts.length;
    if (a + b > 0) s.touched++;
    if (p.noop) s.untouched++;
  }
  return s;
}
