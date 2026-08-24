import { describe, expect, it } from 'vitest';
import { TESTED, type DjSoftware } from '../src/core/djVersions';
import { DEST_CAPABILITY } from '../src/core/sync';
import { PROCESS_PATTERNS } from '../src/main/processGuard';
import { probeVersion } from '../src/main/versionProbe';

/**
 * Il registro dei software supportati, e le superfici che devono restargli
 * allineate.
 *
 * ⚠ Perché questo file esiste. L'elenco dei software era duplicato in otto
 * posti: tipo del registro versioni, sorgenti d'import, capacità di
 * destinazione, id di rilevamento, sonde di versione, pattern di processo,
 * liste dell'interfaccia, chiavi i18n. Aggiungerne uno significava toccarli
 * tutti a mano — e accorgersi di quelli dimenticati solo quando qualcosa non
 * compariva, mesi dopo.
 *
 * Ora la fonte è una sola (`DjSoftware`) e i test qui sotto falliscono se una
 * superficie resta indietro. Non verificano un comportamento: verificano che
 * non si possa dimenticare un pezzo.
 */

const TUTTI = Object.keys(TESTED) as DjSoftware[];

describe('registro dei software DJ', () => {
  it('contiene i software che il progetto dichiara di supportare', () => {
    // Se questo elenco cambia, è una decisione: il test la rende esplicita
    // invece di lasciarla passare in silenzio.
    expect(TUTTI.sort()).toEqual(
      ['engine', 'rekordbox', 'serato', 'serato4', 'traktor', 'virtualdj'].sort()
    );
  });

  it('ogni software ha un marcatore di versione e una prova del collaudo', () => {
    for (const s of TUTTI) {
      const e = TESTED[s];
      expect(e.label, `${s}: manca l'etichetta`).toBeTruthy();
      // ⚠ Il marcatore è ciò che permette al gate di rifiutare una versione mai
      // provata. Senza, la scrittura verso quel software non può essere esposta.
      expect(e.marker, `${s}: manca il marcatore di versione`).toBeTruthy();
      expect(e.maxTested, `${s}: manca la versione collaudata`).toBeTruthy();
      // «Ogni riga è una promessa: su questo, i byte li ho guardati io.»
      expect(e.evidence.length, `${s}: la prova del collaudo è troppo vaga`).toBeGreaterThan(20);
      expect(e.testedOn, `${s}: manca la data del collaudo`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('ogni software ha un pattern di processo', () => {
    // Senza, `assertNotRunning` non saprebbe cosa cercare e la scrittura
    // partirebbe con il programma aperto.
    for (const s of TUTTI) {
      const p = PROCESS_PATTERNS[s];
      expect(p, `${s}: nessun pattern di processo`).toBeDefined();
      expect(p.win.length + p.unix.length, `${s}: pattern vuoto`).toBeGreaterThan(0);
    }
  });

  it('ogni software è una destinazione di sincronizzazione dichiarata', () => {
    // `planSync` rifiuta una destinazione che non conosce: se un software entra
    // nel registro e non qui, la sincronizzazione verso di lui muore a runtime.
    for (const s of TUTTI) {
      const cap = DEST_CAPABILITY[s];
      expect(cap, `${s}: nessuna capacità dichiarata`).toBeDefined();
      expect(cap.hotPads, `${s}: zero pad`).toBeGreaterThan(0);
      expect(typeof cap.canDemote).toBe('boolean');
    }
  });

  it('la sonda di versione risponde per ogni software, senza lanciare', () => {
    // Su un percorso inesistente il verdetto deve essere `null` — «non lo so» —
    // non un'eccezione: la schermata delle versioni interroga tutti i software,
    // compresi quelli non installati.
    for (const s of TUTTI) {
      expect(() => probeVersion(s, 'Z:/percorso/che/non/esiste')).not.toThrow();
      expect(probeVersion(s, 'Z:/percorso/che/non/esiste')).toBeNull();
    }
  });

  it('⚠ Serato ≤3 e Serato 4 restano due voci distinte', () => {
    // Sono formati diversi, non varianti: una cartella di file binari TLV e un
    // database SQLite a grafo. Le due librerie coesistono sulla stessa macchina
    // e hanno marcatori di versione diversi, quindi due gate diversi.
    expect(TESTED.serato.marker).not.toBe(TESTED.serato4.marker);
    expect(TESTED.serato.label).not.toBe(TESTED.serato4.label);
  });

  it('dichiara quali pattern di processo sono assunzioni e quali no', () => {
    /* Il flag è il promemoria di un debito: finché è false, un mancato
       rilevamento è previsto e non va scambiato per un bug.
       Il 24/08/2026 il debito è stato saldato: i nomi sono stati letti da
       `tasklist` con i cinque programmi aperti insieme. Se qualcuno aggiunge un
       software al registro senza fare la stessa verifica, questo test lo
       ferma. */
    const assunti = TUTTI.filter((s) => !PROCESS_PATTERNS[s].verified);
    expect(assunti).toEqual([]);
  });
});
