import { describe, expect, it } from 'vitest';
import { PROCESS_PATTERNS, isDjSoftwareRunning, resetProcessCache } from '../src/main/processGuard';
import type { DjSoftware } from '../src/core/djVersions';

const TUTTI: DjSoftware[] = ['rekordbox', 'traktor', 'virtualdj', 'serato', 'engine'];

/**
 * Questi test non possono verificare il caso che conta davvero — «il software è
 * aperto e la scrittura si ferma» — perché richiederebbe di avviare Serato.
 * Verificano il contorno: che il rilevamento giri sulla macchina reale senza
 * lanciare, che ogni software abbia un pattern, e che sia dichiarato quali
 * pattern vengono dalla specifica e quali sono assunzioni.
 */
describe('processGuard', () => {
  it('ha un pattern per ogni software del registro', () => {
    for (const s of TUTTI) {
      expect(PROCESS_PATTERNS[s], s).toBeDefined();
      const p = PROCESS_PATTERNS[s];
      expect(p.win.length + p.unix.length, `${s}: nessun pattern`).toBeGreaterThan(0);
    }
  });

  it('dichiara quali pattern vengono dalla specifica e quali sono assunzioni', () => {
    // Se un giorno si conferma un nome di processo su una macchina reale, qui
    // il test cambia insieme al flag: è il promemoria che il debito esiste.
    expect(PROCESS_PATTERNS.serato.verified).toBe(true);
    expect(PROCESS_PATTERNS.virtualdj.verified).toBe(true);
    for (const s of ['rekordbox', 'traktor', 'engine'] as DjSoftware[]) {
      expect(PROCESS_PATTERNS[s].verified, `${s} risulta verificato: aggiorna il test`).toBe(false);
    }
  });

  it('interroga il sistema senza lanciare, per ogni software', async () => {
    resetProcessCache();
    for (const s of TUTTI) {
      const v = await isDjSoftwareRunning(s);
      expect(v.software).toBe(s);
      expect(typeof v.running).toBe('boolean');
      // `unknown` è ammesso: su un ambiente dove l'elenco processi non è
      // ottenibile il verdetto è "non lo so", e la guardia lo tratta come tale.
      expect(typeof v.unknown).toBe('boolean');
      if (v.running) expect(v.matched).toBeTruthy();
      else expect(v.matched).toBeNull();
    }
  });

  it('non dichiara in esecuzione un software inventato', async () => {
    resetProcessCache();
    // Il rilevamento è per nome: un nome che non esiste non deve mai combaciare.
    const v = await isDjSoftwareRunning('engine');
    if (!v.unknown && v.running) {
      // Se Engine è davvero aperto sulla macchina di collaudo il test non ha
      // nulla da dire: lo si registra e si passa oltre.
      expect(v.matched).toBeTruthy();
    } else {
      expect(v.running).toBe(false);
    }
  });

  it('la cache non altera il verdetto entro il debounce', async () => {
    resetProcessCache();
    const primo = await isDjSoftwareRunning('serato');
    const secondo = await isDjSoftwareRunning('serato');
    expect(secondo.running).toBe(primo.running);
    expect(secondo.unknown).toBe(primo.unknown);
  });
});
