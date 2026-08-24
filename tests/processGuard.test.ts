import { describe, expect, it } from 'vitest';
import {
  PROCESS_PATTERNS,
  isDjSoftwareRunning,
  resetProcessCache
} from '../src/main/processGuard';
import type { GuardedSoftware } from '../src/main/processGuard';

const TUTTI: GuardedSoftware[] = [
  'rekordbox',
  'traktor',
  'virtualdj',
  'serato',
  'serato4',
  'engine',
  'djay'
];

/**
 * Questi test non possono verificare il caso che conta davvero — «il software è
 * aperto e la scrittura si ferma» — perché richiederebbe di avviare Serato
 * dentro la suite. Verificano il contorno: che il rilevamento giri sulla
 * macchina reale senza lanciare, che ogni software abbia un pattern, e
 * soprattutto che i nomi osservati il 24/08/2026 non vengano persi in un
 * refactoring successivo.
 */
describe('processGuard', () => {
  it('ha un pattern per ogni software presidiato', () => {
    for (const s of TUTTI) {
      expect(PROCESS_PATTERNS[s], s).toBeDefined();
      const p = PROCESS_PATTERNS[s];
      expect(p.win.length + p.unix.length, `${s}: nessun pattern`).toBeGreaterThan(0);
    }
  });

  it('ogni pattern è stato osservato su un processo reale', () => {
    // Il 24/08/2026 i sette software erano installati e in esecuzione insieme
    // sulla macchina di collaudo, e ogni nome è stato letto da `tasklist`.
    // Se qualcuno aggiunge una voce dedotta, questo test la costringe a
    // dichiararsi invece di passare inosservata.
    for (const s of TUTTI) {
      expect(PROCESS_PATTERNS[s].verified, `${s}: pattern non osservato`).toBe(true);
    }
  });

  it('cerca anche i processi ausiliari, non solo la finestra principale', () => {
    // Rekordbox non è un processo, sono cinque: `rekordbox.exe` più quattro
    // `rekordboxAgent.exe`, che sono suoi figli e possono sopravvivergli. È il
    // caso che rompe una guardia ingenua: l'app sembra chiusa, il database è
    // ancora occupato.
    expect(PROCESS_PATTERNS.rekordbox.win).toContain('rekordboxagent.exe');
    // Serato tiene il lock della libreria in un processo dedicato: è il lock a
    // impedire la scrittura, non la finestra.
    expect(PROCESS_PATTERNS.serato.win).toContain('serato_library_ipc_lock_tool.exe');
  });

  it('rileva Serato 4 con gli stessi processi di Serato <=3', () => {
    // Due formati, un solo programma. Il gate delle versioni li separa, il
    // rilevamento no.
    expect(PROCESS_PATTERNS.serato4.win).toEqual(PROCESS_PATTERNS.serato.win);
    expect(PROCESS_PATTERNS.serato4.unix.map(String)).toEqual(
      PROCESS_PATTERNS.serato.unix.map(String)
    );
  });

  it('non scambia per software DJ un processo omonimo', () => {
    // Tutti e tre girano davvero su macchine normali. Con un confronto per
    // sottostringa su «engine», un'utilità di tastiera basterebbe a bloccare
    // per sempre ogni scrittura verso Engine DJ — e l'utente non capirebbe
    // perché. Il confronto è esatto proprio per questo.
    const estranei = [
      'powertoys.keyboardmanagerengine.exe',
      'qtwebengineprocess.exe',
      'ace_engine.exe'
    ];
    for (const s of TUTTI) {
      for (const nome of estranei) {
        expect(PROCESS_PATTERNS[s].win, `${s} combacia con ${nome}`).not.toContain(nome);
      }
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

  it('quando dichiara un software in esecuzione, dice quale processo lo prova', async () => {
    resetProcessCache();
    // Il verdetto non è mai un sì nudo: `matched` è ciò che l'utente deve
    // chiudere, e senza quel nome il messaggio di errore non è azionabile.
    for (const s of TUTTI) {
      const v = await isDjSoftwareRunning(s);
      if (v.unknown || !v.running) continue;
      const atteso =
        process.platform === 'win32'
          ? PROCESS_PATTERNS[s].win.includes(v.matched!) ||
            /^serato dj (pro|lite)( v\d+)?\.exe$/i.test(v.matched!)
          : PROCESS_PATTERNS[s].unix.some((re) => re.test(v.matched!));
      expect(atteso, `${s}: matched "${v.matched}" non spiegato da nessun pattern`).toBe(true);
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
