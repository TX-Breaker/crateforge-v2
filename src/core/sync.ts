import type BetterSqlite3 from 'better-sqlite3';
import type { CueRow } from '@adapters/common';

/**
 * Sincronizzazione dei punti fra software DJ.
 *
 * Che cosa risolve: lo stesso brano esiste in più librerie, ognuna con i suoi
 * cue. Portarli da una all'altra sembra una copia, e non lo è — perché i pad
 * sono pochi, perché i software non hanno tutti gli stessi contenitori, e
 * perché nella destinazione può esserci già del lavoro fatto a mano.
 *
 * DUE MODI, e il predefinito è quello che non si rimpiange:
 *
 *  - `fill` — scrive solo dove la destinazione ha un pad LIBERO. È il caso
 *    normale («ho analizzato in Rekordbox, Traktor è vuoto») e non distrugge
 *    mai niente. È il predefinito.
 *  - `overwrite` — l'origine vince sul pad conteso. Non perché sia più giusta
 *    in astratto, ma perché è ciò che l'utente ha dichiarato scegliendo «da X
 *    a Y»: ha nominato lui il padrone.
 *
 * PERCHÉ NON «vince il più recente». Non esiste una data per cue: non
 * nell'archivio interno, e soprattutto in nessuno dei cinque formati — non nel
 * blob quickCues di Engine, non nei GEOB Serato Markers2, non in CUE_V2 di
 * Traktor, non in POSITION_MARK di Rekordbox. L'unica data disponibile è quella
 * del FILE, che direbbe «ho ri-taggato l'MP3 la settimana scorsa per altro,
 * quindi i suoi cue vincono». Sarebbe arbitrio travestito da criterio.
 *
 * LA COSA CHE CONTA DAVVERO non è chi vince il pad: è che fine fa chi perde.
 * Dove la destinazione ha un contenitore fuori dai pad (memory cue in
 * Rekordbox, HOTCUE=-1 in Traktor, POI senza Num in VirtualDJ) il cue
 * spodestato RETROCEDE e non si perde niente. Dove non c'è (Engine e Serato
 * hanno solo gli otto slot) sparisce davvero: allora si conta, e il numero
 * finisce nella conferma PRIMA di scrivere.
 */

export type SyncMode = 'fill' | 'overwrite';

export interface DestCapability {
  /** slot per gli hot cue */
  hotPads: number;
  /** slot per i loop, se il software li tiene separati; 0 = condivisi con gli hot */
  loopPads: number;
  /**
   * true se un punto fuori dai pad è comunque rappresentabile (memory cue).
   * Quando è false, ciò che non entra nei pad È PERSO — e va detto.
   */
  canDemote: boolean;
}

/**
 * Capacità reali delle destinazioni, misurate sui writer di questo progetto
 * (src/adapters/**) e non sulle brochure dei produttori.
 */
export const DEST_CAPABILITY: Record<string, DestCapability> = {
  // 8 pad condivisi fra hot cue e hot loop; l'eccedenza diventa memory (Num=-1)
  rekordbox: { hotPads: 8, loopPads: 0, canDemote: true },
  // un pad tiene un solo elemento; fuori dai pad resta HOTCUE=-1
  traktor: { hotPads: 8, loopPads: 0, canDemote: true },
  // POI senza Num: il punto sopravvive anche senza pad
  virtualdj: { hotPads: 8, loopPads: 0, canDemote: true },
  // otto CUE + otto LOOP separati nei GEOB, ma nessun contenitore fuori dai pad
  serato: { hotPads: 8, loopPads: 8, canDemote: false },
  /* Serato 4 tiene i cue dove li teneva il <=3: nei tag dei file audio. Stessa
     capacita', stessa perdita fuori dagli otto pad. */
  serato4: { hotPads: 8, loopPads: 8, canDemote: false },
  // otto quickCues + otto loops separati, nessun memory
  engine: { hotPads: 8, loopPads: 8, canDemote: false }
};

/** Un punto pronto per il writer: come CueRow, ma senza legame con una riga. */
export interface ResolvedCue {
  cue_type: 'hot' | 'memory' | 'loop';
  cue_index: number | null;
  position_ms: number;
  length_ms: number | null;
  color: string | null;
  label: string | null;
  /** da quale libreria arriva: serve a spiegare l'esito, non al formato */
  from: 'origin' | 'destination';
  /**
   * Sacca dei campi non normalizzati del punto, trasportata così com'è.
   * Viaggia con il cue perché è ciò che permette al writer di destinazione di
   * riconsegnare al proprio formato quello che ne aveva ricevuto — per esempio
   * il numero di slot originale di un cue Rekordbox, che altrove non esiste.
   */
  data?: string;
}

export interface ResolveResult {
  cues: ResolvedCue[];
  /** pad vuoti riempiti con punti dell'origine */
  filled: number;
  /** pad della destinazione presi da un punto dell'origine */
  replaced: number;
  /** punti scesi fuori dai pad ma conservati */
  demoted: number;
  /** punti che il formato di destinazione non può rappresentare: PERSI */
  lost: number;
}

/** Un loop occupa uno slot loop solo se il software li tiene separati. */
function bankOf(cue: { cue_type: string }, cap: DestCapability): 'hot' | 'loop' {
  return cue.cue_type === 'loop' && cap.loopPads > 0 ? 'loop' : 'hot';
}

function padsOf(bank: 'hot' | 'loop', cap: DestCapability): number {
  return bank === 'loop' ? cap.loopPads : cap.hotPads;
}

const toResolved = (c: CueRow, from: 'origin' | 'destination'): ResolvedCue => ({
  cue_type: c.cue_type,
  cue_index: c.cue_index,
  position_ms: c.position_ms,
  length_ms: c.length_ms,
  color: c.color,
  label: c.label,
  from,
  data: c.data
});

/**
 * Decide quali punti finiranno nella destinazione per UN brano.
 *
 * Funzione pura: nessun database, nessun file. È qui che vive il significato
 * della sincronizzazione, ed è qui che i test possono dimostrarlo.
 */
export function resolveCues(
  origin: CueRow[],
  destination: CueRow[],
  mode: SyncMode,
  cap: DestCapability
): ResolveResult {
  const out: ResolvedCue[] = [];
  const res: ResolveResult = { cues: out, filled: 0, replaced: 0, demoted: 0, lost: 0 };

  /** slot occupati, per banco: `${banco}:${indice}` */
  const taken = new Map<string, ResolvedCue>();
  const slotKey = (bank: string, idx: number) => `${bank}:${idx}`;

  /* I punti della destinazione che stanno FUORI dai pad (memory) non
     partecipano alla contesa: non occupano slot e non vengono spodestati. */
  const destPadded = destination.filter((c) => c.cue_index !== null);
  const destLoose = destination.filter((c) => c.cue_index === null);

  for (const c of destLoose) out.push(toResolved(c, 'destination'));

  // 1) La destinazione prende i suoi pad. È lei che era già lì.
  for (const c of destPadded) {
    const bank = bankOf(c, cap);
    const idx = c.cue_index as number;
    if (idx < 0 || idx >= padsOf(bank, cap)) {
      // Fuori capacità già in partenza: retrocede o si perde, come per l'origine.
      if (cap.canDemote) {
        out.push({ ...toResolved(c, 'destination'), cue_type: 'memory', cue_index: null });
        res.demoted++;
      } else {
        res.lost++;
      }
      continue;
    }
    const entry = toResolved(c, 'destination');
    taken.set(slotKey(bank, idx), entry);
    out.push(entry);
  }

  // 2) L'origine si sistema dove può.
  for (const c of origin) {
    const bank = bankOf(c, cap);
    const pads = padsOf(bank, cap);
    const wanted = c.cue_index;

    /* Punto già fuori pad all'origine (memory): passa solo se la destinazione
       sa tenerlo, altrimenti è una perdita — e va contata, non taciuta. */
    if (wanted === null) {
      if (cap.canDemote) {
        out.push({ ...toResolved(c, 'origin'), cue_type: 'memory', cue_index: null });
      } else {
        res.lost++;
      }
      continue;
    }

    const occupied = wanted >= 0 && wanted < pads ? taken.get(slotKey(bank, wanted)) : undefined;

    // Slot libero e dentro la capacità: entra e basta.
    if (wanted >= 0 && wanted < pads && !occupied) {
      const entry = toResolved(c, 'origin');
      taken.set(slotKey(bank, wanted), entry);
      out.push(entry);
      res.filled++;
      continue;
    }

    // Slot conteso, e siamo in "riempi i vuoti": la destinazione resta com'è.
    if (occupied && mode === 'fill') {
      if (cap.canDemote) {
        out.push({ ...toResolved(c, 'origin'), cue_type: 'memory', cue_index: null });
        res.demoted++;
      } else {
        res.lost++;
      }
      continue;
    }

    // Slot conteso in "sovrascrivi": vince l'origine, e chi perde retrocede.
    if (occupied && mode === 'overwrite') {
      const i = out.indexOf(occupied);
      if (i >= 0) out.splice(i, 1);
      if (cap.canDemote) {
        out.push({ ...occupied, cue_type: 'memory', cue_index: null });
        res.demoted++;
      } else {
        res.lost++;
      }
      const entry = toResolved(c, 'origin');
      taken.set(slotKey(bank, wanted), entry);
      out.push(entry);
      res.replaced++;
      continue;
    }

    /* Fuori capacità (per esempio il nono pad di Engine verso Serato): stessa
       regola dell'eccedenza che il progetto applica già negli export. */
    if (cap.canDemote) {
      out.push({ ...toResolved(c, 'origin'), cue_type: 'memory', cue_index: null });
      res.demoted++;
    } else {
      res.lost++;
    }
  }

  return res;
}

export interface SyncPlan {
  /** brani che riceveranno almeno un punto */
  tracks: number;
  filled: number;
  replaced: number;
  demoted: number;
  lost: number;
  /** true se la destinazione non sa conservare ciò che perde il pad */
  destroys: boolean;
}

/**
 * Prova a vuoto sull'intera libreria: quanti brani, quanti punti, quante
 * perdite. È il numero che l'utente deve vedere PRIMA di confermare — una
 * scrittura si autorizza sapendo quanto costa, non dopo.
 */
export function planSync(
  db: BetterSqlite3.Database,
  opts: {
    /** valori di `tracks.source` da cui leggere i punti */
    originSources: string[];
    /** valori di `tracks.source` della libreria che riceve */
    destinationSources: string[];
    destination: string;
    mode: SyncMode;
  }
): SyncPlan {
  const cap = DEST_CAPABILITY[opts.destination];
  if (!cap) throw new Error(`Destinazione non riconosciuta: ${opts.destination}`);

  const plan: SyncPlan = {
    tracks: 0,
    filled: 0,
    replaced: 0,
    demoted: 0,
    lost: 0,
    destroys: !cap.canDemote
  };

  const q = (list: string[]) => list.map(() => '?').join(',');
  /* Le coppie origine→destinazione dello stesso brano reale: è esattamente ciò
     per cui esiste l'identità canonica. */
  const pairs = db
    .prepare(
      `SELECT o.id AS originId, d.id AS destId
         FROM tracks o
         JOIN tracks d
           ON COALESCE(d.canonical_id, d.id) = COALESCE(o.canonical_id, o.id)
        WHERE o.source IN (${q(opts.originSources)})
          AND d.source IN (${q(opts.destinationSources)})
          AND o.id <> d.id`
    )
    .all(...opts.originSources, ...opts.destinationSources) as {
    originId: number;
    destId: number;
  }[];

  const cuesOf = db.prepare(
    `SELECT * FROM cues WHERE track_id = ? ORDER BY cue_type, cue_index, position_ms`
  );

  for (const p of pairs) {
    const origin = cuesOf.all(p.originId) as CueRow[];
    if (origin.length === 0) continue;
    const dest = cuesOf.all(p.destId) as CueRow[];
    const r = resolveCues(origin, dest, opts.mode, cap);
    if (r.filled + r.replaced === 0 && r.demoted === 0 && r.lost === 0) continue;
    plan.tracks++;
    plan.filled += r.filled;
    plan.replaced += r.replaced;
    plan.demoted += r.demoted;
    plan.lost += r.lost;
  }

  return plan;
}
