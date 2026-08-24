import type { GuardedSoftware } from '@core/djVersions';
import {
  FALLBACK_POLL_MS,
  decideAutoSync,
  detectClosures,
  type AutoSyncDecision,
  type AutoSyncSnapshot
} from '@core/autoSync';
import { PROCESS_PATTERNS, isDjSoftwareRunning, resetProcessCache } from './processGuard';

/**
 * Il guardiano dell'esecuzione automatica: osserva, non decide.
 *
 * La decisione sta in `@core/autoSync`, che è una funzione pura e come tale
 * verificabile per intero. Qui c'è soltanto ciò che quella funzione non può
 * fare: leggere l'orologio, interrogare il sistema operativo, ricordare che
 * cosa era aperto l'ultima volta.
 *
 * ⚠ Tutto ciò che tocca il mondo esterno entra da `Deps`. Non è cerimonia: è
 * l'unico modo per provare con un test la sequenza «Rekordbox era aperto, ora
 * non lo è, quindi il giro parte» senza avere Rekordbox da aprire e chiudere.
 */

export interface AutoSyncDeps {
  /** Adesso. Iniettato perché un test non può aspettare trenta secondi veri. */
  now: () => number;
  /** Software attualmente in esecuzione, o `unknown` se non si è potuto sapere. */
  readRunning: () => Promise<Set<GuardedSoftware> | 'unknown'>;
  /** Software di destinazione configurati dall'utente. */
  destinations: () => GuardedSoftware[];
  /** Interruttore di pausa, che sopravvive al riavvio. */
  isPaused: () => boolean;
  /** Un altro lavoro è in corso. */
  isJobRunning: () => boolean;
  /** Ultima operazione dell'utente sulla libreria. */
  lastUserActivityAt: () => number | null;
  /** Esegue il giro. Riceve origine e destinazioni già decise. */
  runSync: (source: GuardedSoftware, destinations: GuardedSoftware[]) => Promise<void>;
  /** Registra ciò che è successo, per poterlo raccontare dopo. */
  log?: (evento: string, dettaglio: string) => void;
}

export interface AutoSyncStatus {
  /** Ultima decisione presa, per mostrarla nell'interfaccia. */
  lastDecision: AutoSyncDecision | null;
  /** Quando è stata presa. */
  lastDecisionAt: number | null;
  /** Fine dell'ultimo giro andato a buon fine. */
  lastRunAt: number | null;
  /** Chiusure osservate e non ancora consumate, per software. */
  pendingClosures: { software: GuardedSoftware; closedAt: number }[];
}

/**
 * ⚠ Le chiusure si ACCUMULANO invece di sovrascriversi.
 *
 * Chi chiude Rekordbox e poi Serato ha modificato due librerie, non una. Tenere
 * solo l'ultima chiusura perderebbe silenziosamente il primo giro — e il modo
 * in cui lo perderebbe (nessun errore, semplicemente non succede niente) è
 * esattamente quello che in automatico non si nota.
 */
export class AutoSyncWatcher {
  private precedente: Set<GuardedSoftware> | 'unknown' = 'unknown';
  private chiusure = new Map<GuardedSoftware, number>();
  private lastRunAt: number | null = null;
  private ultimaDecisione: AutoSyncDecision | null = null;
  private ultimaDecisioneAt: number | null = null;
  private timer: NodeJS.Timeout | null = null;
  private inCorso = false;

  constructor(private readonly deps: AutoSyncDeps) {}

  status(): AutoSyncStatus {
    return {
      lastDecision: this.ultimaDecisione,
      lastDecisionAt: this.ultimaDecisioneAt,
      lastRunAt: this.lastRunAt,
      pendingClosures: [...this.chiusure.entries()].map(([software, closedAt]) => ({
        software,
        closedAt
      }))
    };
  }

  /**
   * Un giro di osservazione. Va chiamato a intervalli; non fa mai più di un
   * giro di sincronizzazione per volta.
   *
   * ⚠ `inCorso` non è una micro-ottimizzazione. Senza, un intervallo che scatta
   * mentre il giro precedente sta ancora scrivendo ne farebbe partire un
   * secondo sulle stesse librerie.
   */
  async tick(): Promise<AutoSyncDecision | null> {
    if (this.inCorso) return null;

    const attuale = await this.deps.readRunning();
    const ora = this.deps.now();

    /* ⚠ La prima osservazione non può produrre chiusure: non c'è un "prima" con
       cui confrontarla. Senza questo, l'avvio del programma sembrerebbe la
       chiusura simultanea di tutto ciò che non è aperto. */
    for (const software of detectClosures(this.precedente, attuale)) {
      this.chiusure.set(software, ora);
      this.deps.log?.('autosync.closure', software);
    }
    this.precedente = attuale;

    if (this.chiusure.size === 0) return null;

    /* Si consuma la chiusura più VECCHIA: è quella che ha aspettato di più, ed
       è anche quella che ha più probabilità di aver superato la quiete. */
    const [origine, chiusaA] = [...this.chiusure.entries()].sort((a, b) => a[1] - b[1])[0];

    const snapshot: AutoSyncSnapshot = {
      now: ora,
      source: origine,
      // Un software non sincronizza verso se stesso.
      destinations: this.deps.destinations().filter((d) => d !== origine),
      sourceClosedAt: chiusaA,
      running: attuale,
      paused: this.deps.isPaused(),
      jobRunning: this.deps.isJobRunning(),
      lastUserActivityAt: this.deps.lastUserActivityAt(),
      lastRunAt: this.lastRunAt
    };

    const decisione = decideAutoSync(snapshot);
    this.ultimaDecisione = decisione;
    this.ultimaDecisioneAt = ora;

    if (!decisione.run) {
      /* ⚠ Alcuni rifiuti sono definitivi per QUESTA chiusura e non vanno
         riprovati all'infinito: se l'origine è di nuovo aperta, la chiusura che
         avevamo osservato non vale più niente. Tenerla in coda farebbe partire
         un giro appena l'utente richiude, saltando la quiete. */
      if (decisione.reason === 'source-still-open' || decisione.reason === 'nothing-to-do') {
        this.chiusure.delete(origine);
      }
      this.deps.log?.('autosync.skip', `${origine}: ${decisione.reason}`);
      return decisione;
    }

    this.inCorso = true;
    try {
      await this.deps.runSync(decisione.source, decisione.destinations);
      this.lastRunAt = this.deps.now();
      this.chiusure.delete(origine);
      this.deps.log?.('autosync.run', `${origine} -> ${decisione.destinations.join(', ')}`);
    } catch (err) {
      /* ⚠ La chiusura NON si consuma quando il giro fallisce: altrimenti un
         errore transitorio farebbe perdere per sempre la sincronizzazione di
         quella sessione di lavoro, senza che nessuno se ne accorga. */
      this.deps.log?.('autosync.error', `${origine}: ${String(err)}`);
    } finally {
      this.inCorso = false;
    }
    return decisione;
  }

  /**
   * Avvia l'osservazione periodica.
   *
   * ⚠ L'intervallo è quello del RIPIEGO, non un ritmo scelto per reattività. Il
   * segnale vero è la chiusura di un programma; questo cronometro serve solo a
   * guardare abbastanza spesso da vederla. Un intervallo breve non renderebbe
   * la sincronizzazione più tempestiva — la quiete la fa comunque aspettare — e
   * costerebbe una lettura della lista processi ogni volta.
   */
  start(intervalMs = 30_000): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick().catch(() => {
        /* Un tick che fallisce non deve fermare l'orologio: il prossimo
           riprova. L'errore è già stato registrato dentro `tick`. */
      });
    }, intervalMs);
    // Non tiene sveglio il processo: se non c'è altro da fare, si può chiudere.
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

/** Intervallo di ripiego, riesportato per chi configura il guardiano. */
export { FALLBACK_POLL_MS };

/**
 * Legge quali software sono in esecuzione, in un colpo solo.
 *
 * ⚠ Se anche UNO solo risulta indeterminabile, l'esito è `unknown` per tutti.
 * Un insieme parziale sarebbe peggio di nessun insieme: chi lo riceve non
 * saprebbe che è incompleto e lo tratterebbe come una risposta.
 */
export async function readRunningSoftware(): Promise<Set<GuardedSoftware> | 'unknown'> {
  resetProcessCache();
  const attivi = new Set<GuardedSoftware>();
  for (const software of Object.keys(PROCESS_PATTERNS) as GuardedSoftware[]) {
    const v = await isDjSoftwareRunning(software);
    if (v.unknown) return 'unknown';
    if (v.running) attivi.add(software);
  }
  return attivi;
}
