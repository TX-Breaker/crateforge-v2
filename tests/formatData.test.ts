import { describe, expect, it } from 'vitest';
import { mergeFormatData, parseFormatData, readFormatData } from '../src/core/formatData';

/**
 * La sacca dei campi non normalizzati serve a non perdere dati fra un formato
 * e l'altro. La proprietà che DEVE reggere è una sola, ed è quella che i test
 * qui sotto difendono: scrivere la propria chiave non tocca quelle degli altri.
 */
describe('formatData', () => {
  it('legge una sacca vuota da qualunque forma di "niente"', () => {
    for (const raw of [null, undefined, '', '{}']) {
      expect(parseFormatData(raw)).toEqual({});
    }
  });

  it('degrada a sacca vuota invece di lanciare su JSON rotto o non-oggetto', () => {
    // È un campo di comodo: perderne il contenuto peggiora una conversione,
    // non rompe il database. Bloccare l'app qui sarebbe sproporzionato.
    for (const raw of ['{non json', '[]', 'null', '42', '"stringa"']) {
      expect(parseFormatData(raw)).toEqual({});
      expect(readFormatData(raw, 'engine')).toEqual({});
    }
  });

  it('scrivere un formato NON tocca gli altri', () => {
    const dopoEngine = mergeFormatData('{}', 'engine', { thirdPartySourceId: 7 });
    const dopoSerato4 = mergeFormatData(dopoEngine, 'serato4', {
      locationId: 1,
      portableId: 'abc'
    });

    expect(readFormatData(dopoSerato4, 'engine')).toEqual({ thirdPartySourceId: 7 });
    expect(readFormatData(dopoSerato4, 'serato4')).toEqual({ locationId: 1, portableId: 'abc' });
  });

  it('riscrivere un formato sostituisce solo il suo payload', () => {
    const iniziale = mergeFormatData(
      mergeFormatData('{}', 'engine', { thirdPartySourceId: 7, bpmDichiarato: 128 }),
      'traktor',
      { audioId: 'xyz' }
    );
    // Dentro il proprio namespace l'adapter è padrone: sostituisce, non fonde.
    const riscritto = mergeFormatData(iniziale, 'engine', { thirdPartySourceId: 9 });

    expect(readFormatData(riscritto, 'engine')).toEqual({ thirdPartySourceId: 9 });
    expect(readFormatData(riscritto, 'traktor')).toEqual({ audioId: 'xyz' });
  });

  it('un payload vuoto rimuove la chiave invece di lasciare un oggetto vuoto', () => {
    // Così due righe senza campi extra hanno la stessa sacca "{}" e un
    // confronto non segnala una differenza che non esiste.
    const con = mergeFormatData('{}', 'engine', { a: 1 });
    expect(mergeFormatData(con, 'engine', {})).toBe('{}');
  });

  it('scarta i valori undefined ma conserva null e zero', () => {
    const raw = mergeFormatData('{}', 'serato', {
      assente: undefined,
      esplicitamenteNullo: null,
      zero: 0,
      falso: false
    });
    expect(readFormatData(raw, 'serato')).toEqual({
      esplicitamenteNullo: null,
      zero: 0,
      falso: false
    });
  });

  it('sopravvive a un round-trip di serializzazione', () => {
    const payload = { locationId: 1, portableId: 'a/b\\c "virgolette"', nested: { x: [1, 2] } };
    const raw = mergeFormatData('{}', 'serato4', payload);
    expect(readFormatData(JSON.parse(JSON.stringify(raw)) as string, 'serato4')).toEqual(payload);
  });
});
