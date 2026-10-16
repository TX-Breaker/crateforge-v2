import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  DJ_APPS,
  IMPORT_SOURCES,
  availableSourcesFor,
  importSource,
  type ImportSourceId
} from '../src/core/djRegistry';
import { TESTED, type DjSoftware } from '../src/core/djVersions';

/**
 * Il registro delle sorgenti d'import e la procedura guidata.
 *
 * ⚠ Il test che conta davvero è l'ultimo: la vetrina delle funzioni non deve
 * promettere ciò che il programma non fa. È la regola che il mandato chiama
 * «mostra solo funzioni che esistono davvero», ed è l'unica parte di una
 * procedura di benvenuto che può fare un danno reale — l'utente ci arriva
 * convinto, e la delusione arriva dopo che ha importato la libreria.
 */

const welcome = readFileSync(join(process.cwd(), 'src/renderer/src/screens/Welcome.tsx'), 'utf-8');

describe('registro delle sorgenti d’import', () => {
  it('non ha identificatori duplicati', () => {
    const ids = IMPORT_SOURCES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('ogni voce non disponibile dichiara il perché', () => {
    // Una sorgente elencata e spenta senza motivo è peggio di una assente:
    // l'utente non sa se aspettare o cercare altrove.
    for (const s of IMPORT_SOURCES) {
      if (!s.available) {
        expect(s.unavailableKey, `${s.id}: manca il motivo`).toBeTruthy();
      }
    }
  });

  it('ogni sorgente legata a un software punta a una voce del registro versioni', () => {
    for (const s of IMPORT_SOURCES) {
      if (s.software === null) continue;
      expect(TESTED[s.software as DjSoftware], `${s.id} → ${s.software}`).toBeDefined();
    }
  });

  it('le app della griglia riferiscono solo sorgenti esistenti', () => {
    for (const a of DJ_APPS) {
      for (const id of a.sources) {
        expect(() => importSource(id), `${a.id} → ${id}`).not.toThrow();
      }
    }
  });

  it('ogni app ha almeno una sorgente utilizzabile, o è dichiaratamente vuota', () => {
    for (const a of DJ_APPS) {
      const usabili = availableSourcesFor(a);
      if (a.sources.length === 0) {
        // «Nessuna app DJ» non è un ripiego: è il caso di chi ha solo una
        // cartella di file, ed è la ragione per cui esiste il monitoraggio.
        expect(a.id).toBe('none');
        continue;
      }
      const almenoUnaNota = a.sources.some((s) => !importSource(s).available);
      expect(usabili.length > 0 || almenoUnaNota, `${a.id}: nessuna sorgente`).toBe(true);
    }
  });

  it('gli adapter aggiunti nelle sessioni 2 e 3 compaiono nel registro', () => {
    // È il punto del mandato: un adapter nuovo deve comparire nel selettore
    // senza che nessuno si ricordi di aggiungerlo a una seconda lista.
    const ids = new Set<ImportSourceId>(IMPORT_SOURCES.map((s) => s.id));
    for (const atteso of ['serato4', 'djay', 'pioneer-usb'] as ImportSourceId[]) {
      expect(ids.has(atteso), `manca ${atteso}`).toBe(true);
    }
  });
});

describe('procedura di benvenuto', () => {
  it('⚠ non promette funzioni che il programma non ha', () => {
    /* Le voci elencate nel mandato come CANDIDATE ma non implementate. Se una
       di queste compare nel benvenuto, o è stata implementata — e allora
       questo test va aggiornato apposta — oppure è una promessa falsa. */
    const nonImplementate = ['smartlist', 'storeLink', 'beatport', 'cueTemplate', 'genreRenamer'];
    for (const nome of nonImplementate) {
      expect(welcome.includes(nome), `il benvenuto cita ${nome}, che non è implementato`).toBe(false);
    }
  });

  it('sa importare ogni tipo di libreria che il rilevamento può trovare', () => {
    // Un tipo rilevato senza un ramo d'import arriverebbe all'utente come
    // «trovato» e poi fallirebbe: ogni `kind` deve avere il suo `case`.
    for (const kind of ['masterdb', 'seratoDir', 'serato4db', 'nml', 'vdjxml', 'enginedb']) {
      expect(welcome.includes(`case '${kind}':`), `manca l'import per ${kind}`).toBe(true);
    }
  });
});
