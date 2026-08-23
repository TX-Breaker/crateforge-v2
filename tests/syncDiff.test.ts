import { describe, expect, it } from 'vitest';
import {
  diffTrack,
  policyFor,
  sameValue,
  summarize,
  type Policy,
  type SideState,
  type TrackState
} from '../src/core/syncDiff';

/**
 * Il motore di diff è una funzione pura, e questi test sono la ragione per cui
 * lo è: qui si dimostra il comportamento che altrimenti si potrebbe solo
 * provare su una libreria vera — cioè su quella che non ci si può permettere di
 * rompere.
 */

const side = (software: string, track: TrackState, modifiedAt: number | null = null): SideState => ({
  software,
  track,
  modifiedAt
});

const simmetrica: Policy = policyFor('symmetric');
const masterSlave: Policy = policyFor('masterSlave');

describe('confronto dei valori', () => {
  it('non distingue stringa vuota da assente', () => {
    // Fra un software che scrive '' e uno che scrive NULL non c'è una
    // differenza che l'utente riconoscerebbe: trattarla come modifica
    // produrrebbe una riscrittura a ogni giro, per sempre.
    expect(sameValue('', null)).toBe(true);
    expect(sameValue('  ', null)).toBe(true);
  });

  it('ignora gli spazi ai bordi', () => {
    expect(sameValue('House ', 'House')).toBe(true);
  });

  it('tollera lo scarto di arrotondamento sui numeri', () => {
    // 128.00001 e 128 sono lo stesso BPM.
    expect(sameValue(128.00001, 128)).toBe(true);
    expect(sameValue(128.5, 128)).toBe(false);
  });
});

describe('tre vie: chi ha cambiato', () => {
  it('senza base non esiste conflitto, perché non c’è un «prima»', () => {
    const p = diffTrack(
      undefined,
      side('rekordbox', { genre: 'House' }),
      side('traktor', { genre: '' }),
      simmetrica
    );
    expect(p.conflicts).toHaveLength(0);
    expect(p.toB.genre).toBe('House');
  });

  it('ha cambiato solo A: si propaga a B senza chiedere niente', () => {
    const p = diffTrack(
      { genre: 'House' },
      side('rekordbox', { genre: 'Deep House' }),
      side('traktor', { genre: 'House' }),
      simmetrica
    );
    expect(p.toB.genre).toBe('Deep House');
    expect(p.conflicts).toHaveLength(0);
  });

  it('ha cambiato solo B: si propaga ad A', () => {
    const p = diffTrack(
      { genre: 'House' },
      side('rekordbox', { genre: 'House' }),
      side('traktor', { genre: 'Techno' }),
      simmetrica
    );
    expect(p.toA.genre).toBe('Techno');
  });

  it('⚠ hanno cambiato entrambi allo stesso modo: non è un conflitto', () => {
    // Il caso che un confronto a due vie sbaglierebbe al contrario: A e B sono
    // diversi dalla base ma uguali fra loro, quindi non c'è niente da fare.
    const p = diffTrack(
      { genre: 'House' },
      side('rekordbox', { genre: 'Techno' }),
      side('traktor', { genre: 'Techno' }),
      simmetrica
    );
    expect(p.noop).toBe(true);
    expect(p.conflicts).toHaveLength(0);
  });

  it('hanno cambiato entrambi in modo diverso: conflitto', () => {
    const p = diffTrack(
      { genre: 'House' },
      side('rekordbox', { genre: 'Deep House' }),
      side('traktor', { genre: 'Techno' }),
      simmetrica
    );
    expect(p.conflicts).toHaveLength(1);
    expect(p.toA.genre).toBeUndefined();
    expect(p.toB.genre).toBeUndefined();
  });

  it('nessuno ha cambiato: niente da fare', () => {
    const p = diffTrack(
      { genre: 'House', bpm: 128 },
      side('rekordbox', { genre: 'House', bpm: 128 }),
      side('traktor', { genre: 'House', bpm: 128 }),
      simmetrica
    );
    expect(p.noop).toBe(true);
  });
});

describe('⚠ il vuoto non sovrascrive il pieno', () => {
  it('una libreria appena importata non cancella il lavoro dell’altra', () => {
    // È il danno più comune di una sincronizzazione: metà campi non ancora
    // compilati che azzerano quelli compilati. «Non lo so» non si propaga.
    const p = diffTrack(
      undefined,
      side('rekordbox', { genre: '', musical_key: '' }),
      side('traktor', { genre: 'House', musical_key: '8A' }),
      simmetrica
    );
    expect(p.toB).toEqual({});
    expect(p.toA.genre).toBe('House');
    expect(p.toA.musical_key).toBe('8A');
  });

  it('svuotare un campo è un conflitto, non una propagazione', () => {
    // Svuotare per errore è facile, e la cancellazione a distanza è il danno
    // che una sincronizzazione non deve poter fare da sola.
    const p = diffTrack(
      { genre: 'House' },
      side('rekordbox', { genre: '' }),
      side('traktor', { genre: 'House' }),
      simmetrica
    );
    expect(p.conflicts).toHaveLength(1);
    expect(p.conflicts[0].reason).toContain('svuotato');
    expect(p.toB).toEqual({});
  });

  it('nemmeno il master può svuotare a distanza senza dirlo', () => {
    const p = diffTrack(
      { genre: 'House' },
      side('rekordbox', { genre: '' }),
      side('traktor', { genre: 'Techno' }),
      masterSlave
    );
    // Il master vincerebbe, ma non ha un valore: non si scrive.
    expect(p.toB.genre).toBeUndefined();
  });
});

describe('modalità master → slave', () => {
  it('il master vince su tutto, senza conflitti', () => {
    const p = diffTrack(
      { genre: 'House', bpm: 128 },
      side('rekordbox', { genre: 'Deep House', bpm: 126 }),
      side('traktor', { genre: 'Techno', bpm: 130 }),
      masterSlave
    );
    expect(p.conflicts).toHaveLength(0);
    expect(p.toB.genre).toBe('Deep House');
    expect(p.toB.bpm).toBe(126);
    // ⚠ Niente risale verso il master: è il senso di designarlo.
    expect(p.toA).toEqual({});
  });
});

describe('⚠ «il più recente» solo dove c’è una data vera', () => {
  const conTempo = policyFor('symmetric', { temporalFields: ['genre'] });

  it('vince chi ha modificato dopo, quando entrambi lo dichiarano', () => {
    const p = diffTrack(
      { genre: 'House' },
      side('rekordbox', { genre: 'Deep House' }, 2000),
      side('serato4', { genre: 'Techno' }, 1000),
      conTempo
    );
    expect(p.toB.genre).toBe('Deep House');
    expect(p.conflicts).toHaveLength(0);
  });

  it('se un software non dichiara la data, è conflitto e non arbitrio', () => {
    // Senza la data da entrambi i lati, vincerebbe sempre lo stesso per un
    // motivo che non ha niente a che vedere con quando l'utente ha lavorato.
    const p = diffTrack(
      { genre: 'House' },
      side('rekordbox', { genre: 'Deep House' }, 2000),
      side('virtualdj', { genre: 'Techno' }, null),
      conTempo
    );
    expect(p.conflicts).toHaveLength(1);
    expect(p.conflicts[0].reason).toContain('temporale');
  });

  it('stesso istante: non c’è un più recente', () => {
    const p = diffTrack(
      { genre: 'House' },
      side('rekordbox', { genre: 'Deep House' }, 1000),
      side('serato4', { genre: 'Techno' }, 1000),
      conTempo
    );
    expect(p.conflicts).toHaveLength(1);
  });

  it('i cue restano fuori: non esiste una data per cue in nessun formato', () => {
    // Il motore governa i campi di traccia. I punti hanno già il loro modello
    // in `core/sync.ts`, con riempi-i-vuoti e sovrascrivi, e per una ragione
    // precisa: nessun formato porta una data per cue.
    const p = diffTrack(undefined, side('a', { genre: 'X' }), side('b', {}), conTempo);
    expect(p.decisions.every((d) => d.field !== ('cues' as never))).toBe(true);
  });
});

describe('campi che un software non ha', () => {
  it('un campo che nessuno dei due conosce non entra nel piano', () => {
    // Traktor non ha il colore della traccia: non è una differenza, è
    // un'assenza di concetto.
    const p = diffTrack(
      undefined,
      side('traktor', { genre: 'House' }),
      side('virtualdj', { genre: 'House' }),
      simmetrica
    );
    expect(p.decisions.map((d) => d.field)).toEqual(['genre']);
  });
});

describe('determinismo e riepilogo', () => {
  it('due esecuzioni identiche producono lo stesso piano', () => {
    const args = [
      { genre: 'House' },
      side('rekordbox', { genre: 'Deep House', bpm: 126 }),
      side('traktor', { genre: 'Techno' })
    ] as const;
    const uno = diffTrack(args[0], args[1], args[2], simmetrica);
    const due = diffTrack(args[0], args[1], args[2], simmetrica);
    expect(JSON.stringify(uno)).toBe(JSON.stringify(due));
  });

  it('ogni decisione porta il proprio perché', () => {
    // Non è decorazione: è ciò che il rapporto mostra quando l'utente chiede
    // conto di una scrittura.
    const p = diffTrack(
      { genre: 'House' },
      side('rekordbox', { genre: 'Deep House' }),
      side('traktor', { genre: 'Techno' }),
      simmetrica
    );
    for (const d of p.decisions) expect(d.reason.length).toBeGreaterThan(5);
  });

  it('il riepilogo conta ciò che l’utente deve vedere prima di confermare', () => {
    const plans = [
      diffTrack({ genre: 'A' }, side('x', { genre: 'B' }), side('y', { genre: 'A' }), simmetrica),
      diffTrack({ genre: 'A' }, side('x', { genre: 'B' }), side('y', { genre: 'C' }), simmetrica),
      diffTrack({ genre: 'A' }, side('x', { genre: 'A' }), side('y', { genre: 'A' }), simmetrica)
    ];
    const s = summarize(plans);
    expect(s.tracks).toBe(3);
    expect(s.toB).toBe(1);
    expect(s.conflicts).toBe(1);
    expect(s.untouched).toBe(1);
  });
});
