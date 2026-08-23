import { describe, expect, it } from 'vitest';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import {
  SIGNAL_KIND,
  compareSignals,
  contentDigest,
  hasNativeSignal,
  nativeSignalFrom,
  signalFor
} from '../src/core/changeDetect';
import { sameValue, type TrackState } from '../src/core/syncDiff';
import { readSerato4Library } from '../src/adapters/serato4/reader';
import { readEngineLibrary } from '../src/adapters/engine/engineReader';
import { serato4DatabasePath } from '../src/adapters/serato4';

describe('impronta del contenuto', () => {
  it('è deterministica a prescindere dall’ordine delle chiavi', () => {
    // In JavaScript l'ordine delle chiavi dipende da come l'oggetto è stato
    // costruito: l'impronta non deve dipenderne, o due letture della stessa
    // traccia darebbero risultati diversi.
    const a: TrackState = { genre: 'House', bpm: 128, artist: 'X' };
    const b: TrackState = { artist: 'X', bpm: 128, genre: 'House' };
    expect(contentDigest(a)).toBe(contentDigest(b));
  });

  it('⚠ concorda con il confronto del motore di diff', () => {
    /* È l'invariante che tiene insieme le due metà del sistema. Se il diff dice
       «uguali» e l'impronta dice «cambiato», la sincronizzazione riscrive
       all'infinito senza mai convergere. */
    const coppie: [TrackState, TrackState][] = [
      [{ genre: 'House' }, { genre: 'House ' }],
      [{ genre: '' }, {}],
      [{ bpm: 128 }, { bpm: 128.00001 }],
      [{ artist: ' X ' }, { artist: 'X' }]
    ];
    for (const [a, b] of coppie) {
      const campo = Object.keys(a)[0] as keyof TrackState;
      expect(sameValue(a[campo] ?? null, b[campo] ?? null), `${JSON.stringify([a, b])}`).toBe(true);
      expect(contentDigest(a), `${JSON.stringify([a, b])}`).toBe(contentDigest(b));
    }
  });

  it('cambia quando cambia un campo governato', () => {
    expect(contentDigest({ genre: 'House' })).not.toBe(contentDigest({ genre: 'Techno' }));
  });

  it('non cambia per campi che il motore non governa', () => {
    // Un campo fuori dall'elenco non deve far scattare una sincronizzazione.
    const con = { genre: 'House', qualcosaDiAltro: 'x' } as unknown as TrackState;
    expect(contentDigest(con)).toBe(contentDigest({ genre: 'House' }));
  });
});

describe('confronto dei segnali', () => {
  const j = (v: number) => ({ kind: 'journal' as const, value: String(v) });

  it('senza stato precedente non si può dire', () => {
    expect(compareSignals(null, j(5))).toBe('unknown');
  });

  it('journal che avanza: cambiato', () => {
    expect(compareSignals(j(5), j(9))).toBe('changed');
  });

  it('journal fermo: non cambiato', () => {
    expect(compareSignals(j(5), j(5))).toBe('unchanged');
  });

  it('⚠ journal che ARRETRA: cambiato, non «non cambiato»', () => {
    /* Un numero di sequenza monotono che diminuisce significa una cosa sola: la
       libreria è stata ripristinata da un backup. Lo stato di riferimento
       salvato descrive una libreria che non esiste più, e ogni decisione presa
       su quella base sarebbe sbagliata. */
    expect(compareSignals(j(90), j(5))).toBe('changed');
  });

  it('tipi diversi non sono confrontabili, e si ammette', () => {
    // Fingere che lo siano è peggio che dichiarare l'incertezza.
    expect(compareSignals(j(5), { kind: 'digest', value: 'abc' })).toBe('unknown');
  });

  it('impronte diverse: cambiato', () => {
    const a = { kind: 'digest' as const, value: 'aaaa' };
    const b = { kind: 'digest' as const, value: 'bbbb' };
    expect(compareSignals(a, b)).toBe('changed');
    expect(compareSignals(a, a)).toBe('unchanged');
  });
});

describe('scelta della strategia per software', () => {
  it('rispecchia quello che i formati espongono davvero', () => {
    expect(SIGNAL_KIND.rekordbox).toBe('journal');
    expect(SIGNAL_KIND.serato4).toBe('timestamp');
    expect(SIGNAL_KIND.engine).toBe('timestamp');
    // Serato ≤3, VirtualDJ e djay non hanno un segnale per traccia.
    expect(SIGNAL_KIND.serato).toBe('digest');
    expect(SIGNAL_KIND.virtualdj).toBe('digest');
    expect(SIGNAL_KIND.djay).toBe('digest');
  });

  it('un software senza segnale nativo ripiega sull’impronta', () => {
    const s = signalFor('virtualdj', { genre: 'House' });
    expect(s.kind).toBe('digest');
    expect(hasNativeSignal('virtualdj')).toBe(false);
  });

  it('un software con segnale nativo, ma senza valore, ripiega e lo dichiara', () => {
    // Capita sulle righe appena create: non è un errore, ma il tipo cambia e
    // il confronto se ne accorge.
    const s = signalFor('engine', { genre: 'House' }, null);
    expect(s.kind).toBe('digest');
  });

  it('estrae il segnale nativo dalla sacca del formato', () => {
    expect(nativeSignalFrom('engine', { lastEditTime: 1700000000 })).toBe(1700000000);
    expect(nativeSignalFrom('serato4', { timeModified: 1785288661 })).toBe(1785288661);
    expect(nativeSignalFrom('virtualdj', { qualcosa: 1 })).toBeNull();
  });
});

/* --------------------------------------------------- verifica su file reali */

const master = serato4DatabasePath();
const engineDb = join(homedir(), 'Music', 'Engine Library', 'Database2', 'm.db');

const dSerato = master && existsSync(master) ? describe : describe.skip;
const dEngine = existsSync(engineDb) ? describe : describe.skip;

dSerato('Serato 4 — segnale sulla libreria reale', () => {
  it('ogni brano porta un segnale nativo utilizzabile', () => {
    const lib = readSerato4Library(master as string);
    let conSegnale = 0;
    for (const t of lib.tracks) {
      const nativo = nativeSignalFrom('serato4', t.formatData as Record<string, unknown>);
      if (nativo !== null) {
        conSegnale++;
        expect(signalFor('serato4', {}, nativo).kind).toBe('timestamp');
      }
    }
    // Senza segnale nativo il rilevamento incrementale non esiste: si
    // ricadrebbe sull'impronta, che costa una lettura completa a ogni giro.
    expect(conSegnale / lib.tracks.length).toBeGreaterThan(0.9);
    console.log(`[serato4] segnale nativo su ${conSegnale}/${lib.tracks.length} brani`);
  });
});

dEngine('Engine DJ — segnale sulla libreria reale', () => {
  it('ogni brano porta un segnale nativo utilizzabile', () => {
    const lib = readEngineLibrary(engineDb);
    let conSegnale = 0;
    for (const t of lib.tracks) {
      if (nativeSignalFrom('engine', t.formatData as Record<string, unknown>) !== null) {
        conSegnale++;
      }
    }
    expect(conSegnale / lib.tracks.length).toBeGreaterThan(0.9);
    console.log(`[engine] segnale nativo su ${conSegnale}/${lib.tracks.length} brani`);
  });

  it('due letture consecutive danno lo stesso verdetto: non cambiato', () => {
    /* La proprietà che conta davvero: leggere due volte una libreria che non è
       cambiata non deve produrre lavoro. Senza, ogni giro riscriverebbe tutto. */
    const uno = readEngineLibrary(engineDb);
    const due = readEngineLibrary(engineDb);
    let confrontati = 0;
    for (let i = 0; i < uno.tracks.length; i++) {
      const a = signalFor(
        'engine',
        {},
        nativeSignalFrom('engine', uno.tracks[i].formatData as Record<string, unknown>)
      );
      const b = signalFor(
        'engine',
        {},
        nativeSignalFrom('engine', due.tracks[i].formatData as Record<string, unknown>)
      );
      expect(compareSignals(a, b)).toBe('unchanged');
      confrontati++;
    }
    expect(confrontati).toBeGreaterThan(0);
  });
});
