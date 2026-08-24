import { describe, expect, it } from 'vitest';
import {
  FALLBACK_POLL_MS,
  MIN_BETWEEN_RUNS_MS,
  QUIET_PERIOD_MS,
  USER_IDLE_MS,
  decideAutoSync,
  detectClosures,
  shouldContinue,
  type AutoSyncSnapshot
} from '../src/core/autoSync';
import type { GuardedSoftware } from '../src/core/djVersions';

/**
 * La decisione è una funzione pura, quindi si può provare per intero senza
 * aprire e chiudere programmi DJ a comando. È il motivo per cui è stata scritta
 * separata dal guardiano che osserva i processi.
 *
 * ⚠ Ogni test qui sotto descrive un modo in cui una sincronizzazione automatica
 * può rovinare una libreria. Non sono casi limite: sono il motivo per cui le
 * regole esistono.
 */

const ORA = 1_800_000_000_000;

function stato(p: Partial<AutoSyncSnapshot> = {}): AutoSyncSnapshot {
  return {
    now: ORA,
    source: 'rekordbox',
    destinations: ['serato', 'engine'],
    sourceClosedAt: ORA - QUIET_PERIOD_MS - 1,
    running: new Set<GuardedSoftware>(),
    paused: false,
    jobRunning: false,
    lastUserActivityAt: null,
    lastRunAt: null,
    ...p
  };
}

describe('autoSync — quando si può partire', () => {
  it('parte quando tutte le condizioni sono soddisfatte', () => {
    const d = decideAutoSync(stato());
    expect(d.run).toBe(true);
    if (d.run) {
      expect(d.source).toBe('rekordbox');
      expect(d.destinations).toEqual(['serato', 'engine']);
    }
  });

  it('la pausa dell utente vince su tutto il resto', () => {
    // Anche a condizioni perfette. La pausa è una decisione presa da una
    // persona: nessuna euristica la scavalca.
    const d = decideAutoSync(stato({ paused: true }));
    expect(d.run).toBe(false);
    if (!d.run) {
      expect(d.reason).toBe('paused');
      // Non ha senso riprovare da soli: serve che l'utente tolga la pausa.
      expect(d.retryAfterMs).toBeNull();
    }
  });

  it('⚠ non parte se non sa quali programmi sono aperti', () => {
    /* Il caso che decide se questa funzione protegge davvero. Se la lista dei
       processi non è ottenibile, trattare il vuoto come "niente è aperto"
       farebbe partire una scrittura verso una libreria magari in uso. In
       automatico non c'è nessuno che se ne accorga. */
    const d = decideAutoSync(stato({ running: 'unknown' }));
    expect(d.run).toBe(false);
    if (!d.run) {
      expect(d.reason).toBe('processes-unknown');
      // Riprova col ritmo del ripiego: degrada in ritardo, non in rischio.
      expect(d.retryAfterMs).toBe(FALLBACK_POLL_MS);
    }
  });

  it('⚠ non parte mentre una destinazione è aperta', () => {
    /* Traktor tiene la collezione in memoria e la riscrive alla chiusura:
       scrivere ora non fallisce, viene semplicemente cancellato più tardi.
       Nessun errore, e l'utente lo scopre giorni dopo. */
    const d = decideAutoSync(stato({ running: new Set<GuardedSoftware>(['engine']) }));
    expect(d.run).toBe(false);
    if (!d.run) {
      expect(d.reason).toBe('destination-open');
      expect(d.message).toContain('engine');
    }
  });

  it('non parte se l origine è stata riaperta', () => {
    const d = decideAutoSync(stato({ running: new Set<GuardedSoftware>(['rekordbox']) }));
    expect(d.run).toBe(false);
    if (!d.run) expect(d.reason).toBe('source-still-open');
  });

  it('non parte senza aver visto una chiusura', () => {
    // L'innesco è una chiusura osservata, non l'assenza di un processo:
    // altrimenti partirebbe per ogni programma mai aperto, a ogni controllo.
    const d = decideAutoSync(stato({ sourceClosedAt: null }));
    expect(d.run).toBe(false);
    if (!d.run) expect(d.reason).toBe('source-still-open');
  });

  it('⚠ aspetta la quiete, per chi chiude e riapre subito', () => {
    /* Chiudere Rekordbox e riaprirlo perché si era dimenticato qualcosa è
       normale. Senza attesa, quella riapertura troverebbe una
       sincronizzazione già in corso sulla libreria che sta per usare. */
    const d = decideAutoSync(stato({ sourceClosedAt: ORA - 10_000 }));
    expect(d.run).toBe(false);
    if (!d.run) {
      expect(d.reason).toBe('quiet-period');
      // Il tempo che manca, non un valore fisso: chi aspetta sa quanto.
      expect(d.retryAfterMs).toBe(QUIET_PERIOD_MS - 10_000);
    }
  });

  it('rimanda mentre un altro lavoro è in corso', () => {
    const d = decideAutoSync(stato({ jobRunning: true }));
    expect(d.run).toBe(false);
    if (!d.run) expect(d.reason).toBe('job-running');
  });

  it('rimanda se l utente ha appena toccato la libreria', () => {
    // Chi ha appena importato sta guardando il risultato: cambiargli le carte
    // in quel momento è il modo peggiore di essere utili.
    const d = decideAutoSync(stato({ lastUserActivityAt: ORA - 60_000 }));
    expect(d.run).toBe(false);
    if (!d.run) {
      expect(d.reason).toBe('user-active');
      expect(d.retryAfterMs).toBe(USER_IDLE_MS - 60_000);
    }
  });

  it('parte quando l attività dell utente è abbastanza lontana', () => {
    const d = decideAutoSync(stato({ lastUserActivityAt: ORA - USER_IDLE_MS - 1 }));
    expect(d.run).toBe(true);
  });

  it('non ripete un giro a raffica', () => {
    const d = decideAutoSync(stato({ lastRunAt: ORA - 1_000 }));
    expect(d.run).toBe(false);
    if (!d.run) {
      expect(d.reason).toBe('too-soon');
      expect(d.retryAfterMs).toBe(MIN_BETWEEN_RUNS_MS - 1_000);
    }
  });

  it('non parte senza destinazioni', () => {
    const d = decideAutoSync(stato({ destinations: [] }));
    expect(d.run).toBe(false);
    if (!d.run) expect(d.reason).toBe('nothing-to-do');
  });

  it('riporta il motivo più utile quando i motivi sono più di uno', () => {
    /* In pausa E con un lavoro in corso E dentro la quiete: chi legge vuole
       sapere che ha messo in pausa, non che mancano dodici secondi. */
    const d = decideAutoSync(
      stato({ paused: true, jobRunning: true, sourceClosedAt: ORA - 1_000 })
    );
    expect(d.run).toBe(false);
    if (!d.run) expect(d.reason).toBe('paused');
  });
});

describe('autoSync — riconoscere una chiusura', () => {
  it('vede la transizione da aperto a chiuso', () => {
    const chiusi = detectClosures(
      new Set<GuardedSoftware>(['rekordbox', 'serato']),
      new Set<GuardedSoftware>(['serato'])
    );
    expect(chiusi).toEqual(['rekordbox']);
  });

  it('non scambia per chiusura un programma mai aperto', () => {
    const chiusi = detectClosures(
      new Set<GuardedSoftware>(),
      new Set<GuardedSoftware>()
    );
    expect(chiusi).toEqual([]);
  });

  it('⚠ non deduce niente da un osservazione mancante', () => {
    /* Trattare "non lo so" come "chiuso" inventerebbe una chiusura che nessuno
       ha visto — e quella chiusura inventata farebbe partire una scrittura. */
    expect(detectClosures('unknown', new Set<GuardedSoftware>())).toEqual([]);
    expect(detectClosures(new Set<GuardedSoftware>(['rekordbox']), 'unknown')).toEqual([]);
    expect(detectClosures('unknown', 'unknown')).toEqual([]);
  });
});

describe('autoSync — interruzione', () => {
  it('si ferma solo quando gli viene chiesto', () => {
    expect(shouldContinue({ requested: false })).toBe(true);
    expect(shouldContinue({ requested: true })).toBe(false);
  });
});
