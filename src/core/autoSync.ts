import type { GuardedSoftware } from './djVersions';

/**
 * Esecuzione automatica della sincronizzazione: la DECISIONE, separata da chi
 * la esegue.
 *
 * Perché questo file sta separato dal guardiano che osserva i processi. La
 * domanda «si può partire adesso?» ha otto risposte possibili e sette sono
 * «no, per questo motivo». Metterla dentro un cronometro che legge la lista dei
 * processi renderebbe l'unica parte che può causare danni anche l'unica non
 * verificabile con un test: servirebbe una macchina con cinque programmi DJ da
 * aprire e chiudere a comando.
 *
 * Qui dentro non ci sono orologi, processi né database: entra una fotografia
 * dello stato, esce una decisione con la sua motivazione. Il chiamante scatta
 * la fotografia e obbedisce.
 *
 * ⚠ Il principio che governa tutte le regole: in automatico non c'è nessuno che
 * guardi. Chi avvia una sincronizzazione a mano legge il rapporto e si accorge
 * se qualcosa non torna; qui il rapporto non lo legge nessuno. Quindi ogni
 * dubbio si risolve rimandando, mai procedendo — un giro rimandato costa un
 * ritardo, un giro sbagliato costa la libreria.
 */

/** Istanti in millisecondi dall'epoca: il chiamante li misura, qui si confrontano. */
export interface AutoSyncSnapshot {
  /** Adesso, secondo il chiamante. L'orologio non si legge qui dentro. */
  now: number;
  /** Software di origine: quello che chiudendosi ha innescato il giro. */
  source: GuardedSoftware;
  /** Software verso cui si scriverebbe. */
  destinations: GuardedSoftware[];
  /**
   * Quando l'origine è stata vista chiudersi. `null` se non è ancora successo:
   * l'automatico non parte per un timer, parte per una chiusura.
   */
  sourceClosedAt: number | null;
  /**
   * Software attualmente in esecuzione, secondo la guardia.
   *
   * ⚠ `unknown` NON è un insieme vuoto. Se la lista dei processi non è
   * ottenibile non sappiamo se qualcosa sia aperto, e in automatico questo vale
   * «non si tocca niente».
   */
  running: Set<GuardedSoftware> | 'unknown';
  /** Interruttore di pausa dell'utente, che sopravvive al riavvio. */
  paused: boolean;
  /** Un altro lavoro è già in corso (import, export, conversione). */
  jobRunning: boolean;
  /** Ultima operazione dell'utente sulla libreria, o `null` se mai. */
  lastUserActivityAt: number | null;
  /** Fine dell'ultimo giro automatico, per non ripeterlo a raffica. */
  lastRunAt: number | null;
}

export type AutoSyncReason =
  | 'paused'
  | 'source-still-open'
  | 'quiet-period'
  | 'destination-open'
  | 'processes-unknown'
  | 'job-running'
  | 'user-active'
  | 'too-soon'
  | 'nothing-to-do';

export type AutoSyncDecision =
  | { run: true; source: GuardedSoftware; destinations: GuardedSoftware[] }
  | { run: false; reason: AutoSyncReason; message: string; retryAfterMs: number | null };

/**
 * Quiete dopo la chiusura dell'origine.
 *
 * ⚠ Non è un margine di sicurezza generico: serve al caso concreto di chi
 * chiude Rekordbox e lo riapre subito perché aveva dimenticato qualcosa. Senza
 * attesa, quella riapertura troverebbe una sincronizzazione già partita.
 */
export const QUIET_PERIOD_MS = 30_000;

/**
 * Distanza minima da un'operazione dell'utente sulla libreria.
 *
 * Chi ha appena importato o convertito qualcosa sta ancora guardando il
 * risultato. Una sincronizzazione che parte in quel momento gli cambia le carte
 * mentre le sta leggendo.
 */
export const USER_IDLE_MS = 5 * 60_000;

/** Distanza minima fra due giri automatici. */
export const MIN_BETWEEN_RUNS_MS = 60_000;

/**
 * Intervallo del ripiego, per quando il rilevamento dei processi non è
 * affidabile: si sonda di rado e non si scrive mai senza il via libera della
 * guardia. Degrada in ritardo, non in rischio.
 */
export const FALLBACK_POLL_MS = 15 * 60_000;

/**
 * Si può partire?
 *
 * L'ordine dei controlli non è casuale: prima quelli che dipendono dalla
 * volontà dell'utente, poi quelli sullo stato del mondo, infine quelli
 * temporali. Così il motivo riportato è sempre il più utile da leggere — a chi
 * ha messo in pausa non serve sapere che mancano anche dodici secondi di quiete.
 */
export function decideAutoSync(s: AutoSyncSnapshot): AutoSyncDecision {
  const no = (
    reason: AutoSyncReason,
    message: string,
    retryAfterMs: number | null
  ): AutoSyncDecision => ({ run: false, reason, message, retryAfterMs });

  if (s.paused) {
    return no('paused', 'La sincronizzazione automatica è in pausa.', null);
  }

  if (s.destinations.length === 0) {
    return no('nothing-to-do', 'Nessun software di destinazione configurato.', null);
  }

  /* ⚠ Prima dei controlli sui singoli software: se non sappiamo che cosa sta
     girando, non sappiamo nemmeno se l'origine si sia chiusa davvero né se una
     destinazione sia aperta. In automatico «non lo so» vale «no». */
  if (s.running === 'unknown') {
    return no(
      'processes-unknown',
      "Non è stato possibile leggere l'elenco dei processi: la sincronizzazione " +
        'automatica non parte finché non si sa quali programmi sono aperti.',
      FALLBACK_POLL_MS
    );
  }

  const inEsecuzione = s.running;

  if (inEsecuzione.has(s.source)) {
    return no('source-still-open', 'Il software di origine è di nuovo aperto.', null);
  }

  if (s.sourceClosedAt === null) {
    return no(
      'source-still-open',
      "Non è ancora stata osservata una chiusura del software di origine.",
      null
    );
  }

  const daChiusura = s.now - s.sourceClosedAt;
  if (daChiusura < QUIET_PERIOD_MS) {
    return no(
      'quiet-period',
      'Attesa di quiete dopo la chiusura, per non partire su una riapertura immediata.',
      QUIET_PERIOD_MS - daChiusura
    );
  }

  /* ⚠ Le destinazioni aperte non sono un problema di lock: Traktor tiene la
     collezione in memoria e la riscrive alla chiusura, quindi scrivere ora
     significa farsi cancellare più tardi, senza un errore che lo segnali. */
  const aperte = s.destinations.filter((d) => inEsecuzione.has(d));
  if (aperte.length > 0) {
    return no(
      'destination-open',
      `Software di destinazione ancora aperti: ${aperte.join(', ')}. ` +
        'Scrivere adesso significherebbe farsi sovrascrivere alla loro chiusura.',
      null
    );
  }

  if (s.jobRunning) {
    return no('job-running', 'Un altro lavoro è già in corso.', MIN_BETWEEN_RUNS_MS);
  }

  if (s.lastUserActivityAt !== null) {
    const daAttivita = s.now - s.lastUserActivityAt;
    if (daAttivita < USER_IDLE_MS) {
      return no(
        'user-active',
        'Operazione recente sulla libreria: la sincronizzazione aspetta che tu abbia finito.',
        USER_IDLE_MS - daAttivita
      );
    }
  }

  if (s.lastRunAt !== null) {
    const daGiro = s.now - s.lastRunAt;
    if (daGiro < MIN_BETWEEN_RUNS_MS) {
      return no(
        'too-soon',
        'Giro automatico troppo ravvicinato al precedente.',
        MIN_BETWEEN_RUNS_MS - daGiro
      );
    }
  }

  return { run: true, source: s.source, destinations: s.destinations };
}

/**
 * Riconosce la CHIUSURA di un software confrontando due osservazioni.
 *
 * ⚠ Serve la transizione, non lo stato. Un software che non è in esecuzione non
 * è un innesco: se lo fosse, l'automatico partirebbe per ogni programma mai
 * aperto, ogni volta che si guarda. L'innesco è il passaggio da aperto a
 * chiuso, e va osservato.
 *
 * ⚠⚠ Se una delle due osservazioni è `unknown` non si deduce niente. Trattare
 * «non lo so» come «chiuso» inventerebbe una chiusura che nessuno ha visto, e
 * quella chiusura inventata farebbe partire una scrittura.
 */
export function detectClosures(
  prima: Set<GuardedSoftware> | 'unknown',
  dopo: Set<GuardedSoftware> | 'unknown'
): GuardedSoftware[] {
  if (prima === 'unknown' || dopo === 'unknown') return [];
  return [...prima].filter((s) => !dopo.has(s));
}

/**
 * Un giro automatico si interrompe FRA una traccia e l'altra, mai a metà di una
 * scrittura.
 *
 * ⚠ L'unità atomica è la traccia. Fermarsi a metà della scrittura di una lascia
 * la libreria di destinazione in uno stato che nessuna delle due parti ha mai
 * voluto — ed è lo stato che l'utente si trova davanti in serata. Questa
 * funzione è il punto in cui il giro chiede il permesso di proseguire: si
 * chiama fra due unità, mai dentro una.
 */
export function shouldContinue(stop: { requested: boolean }): boolean {
  return !stop.requested;
}

/* ------------------------------------------------------- configurazione */

/** Chiave in `settings`. Una sola, cosi' la configurazione resta atomica. */
export const AUTO_SYNC_SETTING_KEY = 'sync.auto';

export interface AutoSyncConfig {
  /**
   * Interruttore principale. SPENTO di serie, e non per prudenza generica:
   * accendere la scrittura automatica verso le librerie di altri programmi e'
   * una decisione che deve prendere una persona, dopo aver visto almeno una
   * volta che cosa produce un giro manuale.
   */
  enabled: boolean;
  /** Pausa temporanea, distinta dallo spegnimento: sopravvive al riavvio. */
  paused: boolean;
  /** Software che partecipano. Chi si chiude fa da origine, gli altri da destinazione. */
  softwares: GuardedSoftware[];
  /** Campi da propagare. Vuoto significa nessuno: il motore non sceglie da solo. */
  fields: string[];
  /** Modalita' del giro automatico. */
  mode: 'symmetric' | 'masterSlave';
}

/**
 * Predefiniti.
 *
 * ⚠ `softwares` vuoto non e' un segnaposto da riempire: senza destinazioni la
 * decisione risponde `nothing-to-do` e non parte niente. Chi accende
 * l'automatico deve dire anche su che cosa, perche' «tutti quelli che trovo»
 * significherebbe scrivere in librerie che l'utente non ha mai nominato.
 */
export const AUTO_SYNC_DEFAULTS: AutoSyncConfig = {
  enabled: false,
  paused: false,
  softwares: [],
  fields: [],
  mode: 'symmetric'
};

const SOFTWARE_AMMESSI: GuardedSoftware[] = [
  'rekordbox',
  'traktor',
  'virtualdj',
  'serato',
  'serato4',
  'engine',
  'djay'
];

/**
 * Legge la configurazione da cio' che c'e' in `settings`.
 *
 * ⚠ Tollerante per progetto. Il valore arriva da una colonna di testo che puo'
 * essere stata scritta da una versione precedente, modificata a mano o
 * troncata. Un errore di lettura qui non deve impedire l'avvio del programma:
 * ogni campo illeggibile ricade sul predefinito, e i predefiniti non fanno
 * partire niente. Il caso peggiore e' che l'automatico resti spento.
 */
export function parseAutoSyncConfig(raw: string | null): AutoSyncConfig {
  if (!raw) return { ...AUTO_SYNC_DEFAULTS };
  let letto: unknown;
  try {
    letto = JSON.parse(raw);
  } catch {
    return { ...AUTO_SYNC_DEFAULTS };
  }
  if (!letto || typeof letto !== 'object' || Array.isArray(letto)) {
    return { ...AUTO_SYNC_DEFAULTS };
  }
  const o = letto as Record<string, unknown>;
  const ammessi = new Set<string>(SOFTWARE_AMMESSI);
  return {
    enabled: o.enabled === true,
    paused: o.paused === true,
    /* Un nome di software non piu' riconosciuto viene scartato, non conservato:
       tenerlo significherebbe attendere la chiusura di un programma che questa
       versione non sa nemmeno cercare. */
    softwares: Array.isArray(o.softwares)
      ? (o.softwares.filter((x) => typeof x === 'string' && ammessi.has(x)) as GuardedSoftware[])
      : [],
    fields: Array.isArray(o.fields) ? o.fields.filter((x): x is string => typeof x === 'string') : [],
    mode: o.mode === 'masterSlave' ? 'masterSlave' : 'symmetric'
  };
}

export function serializeAutoSyncConfig(c: AutoSyncConfig): string {
  return JSON.stringify(c);
}
