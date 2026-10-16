import { describe, expect, it } from 'vitest';
import { AutoSyncWatcher, type AutoSyncDeps } from '../src/main/autoSyncWatcher';
import { MIN_BETWEEN_RUNS_MS, QUIET_PERIOD_MS } from '../src/core/autoSync';
import type { GuardedSoftware } from '../src/core/djVersions';

/**
 * Il guardiano osserva e ricorda; la decisione sta altrove ed è provata in
 * `autoSync.test.ts`. Qui si verifica la memoria: che una chiusura venga vista,
 * che non venga inventata, e che non venga persa.
 *
 * Tutte le dipendenze sul mondo esterno sono iniettate, quindi la sequenza
 * «era aperto, ora non lo è, sono passati trenta secondi» si costruisce senza
 * aprire nulla e senza aspettare.
 */

const ORA = 1_800_000_000_000;

function banco(p: Partial<AutoSyncDeps> = {}) {
  let orologio = ORA;
  let running: Set<GuardedSoftware> | 'unknown' = new Set<GuardedSoftware>();
  const giri: { source: GuardedSoftware; destinations: GuardedSoftware[] }[] = [];
  let fallisci = false;

  const deps: AutoSyncDeps = {
    now: () => orologio,
    readRunning: async () => running,
    // I partecipanti, origine compresa: il guardiano toglie da solo chi si è chiuso.
    destinations: () => ['rekordbox', 'serato', 'engine'],
    isPaused: () => false,
    isJobRunning: () => false,
    lastUserActivityAt: () => null,
    runSync: async (source, destinations) => {
      if (fallisci) throw new Error('scrittura fallita');
      giri.push({ source, destinations });
    },
    ...p
  };

  return {
    deps,
    giri,
    watcher: new AutoSyncWatcher(deps),
    avanza: (ms: number) => (orologio += ms),
    imposta: (r: Set<GuardedSoftware> | 'unknown') => (running = r),
    rompi: (v: boolean) => (fallisci = v)
  };
}

const aperto = (...s: GuardedSoftware[]) => new Set<GuardedSoftware>(s);

describe('AutoSyncWatcher', () => {
  it('⚠ la prima osservazione non inventa chiusure', async () => {
    /* All'avvio non c'è un "prima" con cui confrontarsi. Senza questa regola,
       far partire CrateForge sembrerebbe la chiusura simultanea di ogni
       programma non aperto, e innescherebbe giri per tutti. */
    const b = banco();
    b.imposta(aperto());
    expect(await b.watcher.tick()).toBeNull();
    expect(b.watcher.status().pendingClosures).toEqual([]);
    expect(b.giri).toEqual([]);
  });

  it('vede una chiusura e parte dopo la quiete', async () => {
    const b = banco();
    b.imposta(aperto('rekordbox'));
    await b.watcher.tick(); // prima osservazione: rekordbox aperto

    b.imposta(aperto());
    const subito = await b.watcher.tick();
    // La chiusura è registrata, ma la quiete non è ancora passata.
    expect(subito?.run).toBe(false);
    if (subito && !subito.run) expect(subito.reason).toBe('quiet-period');
    expect(b.giri).toEqual([]);

    b.avanza(QUIET_PERIOD_MS + 1);
    const dopo = await b.watcher.tick();
    expect(dopo?.run).toBe(true);
    expect(b.giri).toEqual([{ source: 'rekordbox', destinations: ['serato', 'engine'] }]);
  });

  it('non sincronizza un software verso se stesso', async () => {
    const b = banco({ destinations: () => ['serato', 'rekordbox', 'engine'] });
    b.imposta(aperto('rekordbox'));
    await b.watcher.tick();
    b.imposta(aperto());
    await b.watcher.tick(); // registra la chiusura
    b.avanza(QUIET_PERIOD_MS + 1);
    await b.watcher.tick();
    expect(b.giri[0]?.destinations).toEqual(['serato', 'engine']);
  });

  it('⚠ non perde la seconda chiusura quando se ne chiudono due', async () => {
    /* Chi chiude Rekordbox e poi Serato ha modificato due librerie. Tenere solo
       l'ultima chiusura perderebbe il primo giro senza un errore: semplicemente
       non succederebbe niente, che in automatico nessuno nota. */
    const b = banco({ destinations: () => ['rekordbox', 'serato', 'engine'] });
    b.imposta(aperto('rekordbox', 'serato'));
    await b.watcher.tick();

    b.imposta(aperto());
    await b.watcher.tick(); // registra ENTRAMBE le chiusure
    b.avanza(QUIET_PERIOD_MS + 1);
    await b.watcher.tick(); // consuma la più vecchia
    /* Fra due giri automatici c'è una distanza minima: senza avanzare
       l'orologio il secondo verrebbe rimandato, ed è giusto così. */
    b.avanza(MIN_BETWEEN_RUNS_MS + 1);
    await b.watcher.tick(); // consuma la rimanente

    expect(b.giri.map((g) => g.source).sort()).toEqual(['rekordbox', 'serato']);
  });

  it('⚠ non consuma la chiusura se il giro fallisce', async () => {
    /* Un errore transitorio non deve far perdere per sempre la
       sincronizzazione di quella sessione di lavoro. */
    const b = banco();
    b.imposta(aperto('rekordbox'));
    await b.watcher.tick();
    b.imposta(aperto());
    await b.watcher.tick(); // registra la chiusura
    b.avanza(QUIET_PERIOD_MS + 1);

    b.rompi(true);
    await b.watcher.tick();
    expect(b.giri).toEqual([]);
    expect(b.watcher.status().pendingClosures.map((c) => c.software)).toEqual(['rekordbox']);

    b.rompi(false);
    await b.watcher.tick();
    expect(b.giri.map((g) => g.source)).toEqual(['rekordbox']);
  });

  it('⚠ dimentica la chiusura se il software viene riaperto', async () => {
    /* La chiusura osservata non vale più niente. Tenerla in coda farebbe
       partire un giro appena l'utente richiude il programma, saltando la
       quiete che serve proprio a coprire quel caso. */
    const b = banco();
    b.imposta(aperto('rekordbox'));
    await b.watcher.tick();
    b.imposta(aperto());
    await b.watcher.tick(); // chiusura registrata

    b.imposta(aperto('rekordbox')); // riaperto
    const d = await b.watcher.tick();
    expect(d?.run).toBe(false);
    if (d && !d.run) expect(d.reason).toBe('source-still-open');
    expect(b.watcher.status().pendingClosures).toEqual([]);
  });

  it('⚠ un elenco processi illeggibile non produce chiusure', async () => {
    /* Trattare "non lo so" come "chiuso" inventerebbe l'innesco di una
       scrittura. */
    const b = banco();
    b.imposta(aperto('rekordbox'));
    await b.watcher.tick();
    b.imposta('unknown');
    await b.watcher.tick();
    expect(b.watcher.status().pendingClosures).toEqual([]);
    expect(b.giri).toEqual([]);
  });

  it('rispetta la pausa senza dimenticare la chiusura', async () => {
    // La pausa rimanda, non annulla: togliendola il giro deve partire.
    let inPausa = true;
    const b = banco({ isPaused: () => inPausa });
    b.imposta(aperto('rekordbox'));
    await b.watcher.tick();
    b.imposta(aperto());
    await b.watcher.tick(); // registra la chiusura
    b.avanza(QUIET_PERIOD_MS + 1);

    await b.watcher.tick();
    expect(b.giri).toEqual([]);
    expect(b.watcher.status().pendingClosures.map((c) => c.software)).toEqual(['rekordbox']);

    inPausa = false;
    await b.watcher.tick();
    expect(b.giri.map((g) => g.source)).toEqual(['rekordbox']);
  });

  it('riporta lo stato in modo leggibile', () => {
    const b = banco();
    const s = b.watcher.status();
    expect(s.lastDecision).toBeNull();
    expect(s.lastRunAt).toBeNull();
    expect(s.pendingClosures).toEqual([]);
  });

  it('⚠ la chiusura di un programma che non partecipa viene ignorata', async () => {
    /* Prima diventava l'origine di un giro verso tutti i partecipanti: chiudere
       un programma mai scelto scriveva nelle librerie degli altri. */
    const b = banco({ destinations: () => ['serato', 'engine'] });
    b.imposta(aperto('rekordbox'));
    await b.watcher.tick();
    b.imposta(aperto());
    await b.watcher.tick();
    expect(b.watcher.status().pendingClosures).toEqual([]);
  });

  it('⚠ in master → slave la chiusura di uno slave si scarta', async () => {
    const b = banco({ master: () => 'rekordbox' });
    b.imposta(aperto('serato'));
    await b.watcher.tick();
    b.imposta(aperto());
    // Scartata subito, alla chiusura: non aspetta la quiete per poi non partire.
    const d = await b.watcher.tick();
    expect(d && !d.run && d.reason).toBe('slave-closed');
    b.avanza(QUIET_PERIOD_MS + 1);
    expect(await b.watcher.tick()).toBeNull();
    expect(b.giri).toEqual([]);
    expect(b.watcher.status().pendingClosures).toEqual([]);
  });
});
