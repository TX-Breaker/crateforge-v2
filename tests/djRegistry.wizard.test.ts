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
import { pageText } from '../src/renderer/src/lib/i18nPages';
import { LOCALES } from '../src/renderer/src/lib/i18n';

/**
 * Il registro delle sorgenti d'import e la procedura guidata.
 *
 * ⚠ Il test che conta davvero è l'ultimo: la vetrina delle funzioni non deve
 * promettere ciò che il programma non fa. È la regola che il mandato chiama
 * «mostra solo funzioni che esistono davvero», ed è l'unica parte di una
 * procedura di benvenuto che può fare un danno reale — l'utente ci arriva
 * convinto, e la delusione arriva dopo che ha importato la libreria.
 */

const wizard = readFileSync(
  join(process.cwd(), 'src/renderer/src/pages/onboarding/WizardSteps.tsx'),
  'utf-8'
);

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

  it('ogni etichetta esiste in tutte le lingue', () => {
    const chiavi = [
      ...IMPORT_SOURCES.map((s) => s.labelKey),
      ...IMPORT_SOURCES.filter((s) => s.unavailableKey).map((s) => s.unavailableKey as string),
      ...DJ_APPS.map((a) => a.labelKey)
    ];
    for (const { id: locale } of LOCALES) {
      for (const k of chiavi) {
        const testo = pageText(locale, 'onboarding', k);
        expect(testo, `${locale}/${k}`).toBeTruthy();
        // `pageText` restituisce la chiave stessa quando non la trova.
        expect(testo, `${locale}/${k}: chiave non tradotta`).not.toBe(k);
      }
    }
  });
});

describe('vetrina delle funzioni', () => {
  it('⚠ non promette funzioni che il programma non ha', () => {
    /* Le voci elencate nel mandato come CANDIDATE ma non implementate. Se una
       di queste compare nella vetrina, o è stata implementata — e allora
       questo test va aggiornato apposta — oppure è una promessa falsa. */
    const nonImplementate = ['smartlist', 'storeLink', 'beatport', 'cueTemplate', 'genreRenamer'];
    for (const nome of nonImplementate) {
      expect(
        wizard.includes(`'${nome}'`),
        `la vetrina cita ${nome}, che non è implementato`
      ).toBe(false);
    }
  });

  it('elenca solo funzioni con una destinazione reale nel programma', () => {
    // Ogni voce della vetrina deve corrispondere a qualcosa che esiste: i
    // duplicati e la salute stanno in CleanupPage/HealthPage, il monitoraggio
    // in ArrivalsPage, la sincronizzazione dei punti in ConvertPage.
    for (const id of ['duplicates', 'watcher', 'health', 'sync']) {
      expect(wizard.includes(`id: '${id}'`), `manca la voce ${id}`).toBe(true);
    }
  });

  it('dichiara esplicitamente cosa non c’è ancora', () => {
    // Dire cosa manca vale quanto dire cosa c'è: senza, l'assenza sembra una
    // svista invece di una scelta.
    for (const { id: locale } of LOCALES) {
      const testo = pageText(locale, 'onboarding', 'featSoonBody');
      expect(testo, `${locale}: manca l'avviso sulle funzioni assenti`).toBeTruthy();
      expect(testo).not.toBe('featSoonBody');
    }
  });
});
