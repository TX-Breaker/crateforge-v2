import { describe, expect, it } from 'vitest';
import { MAIN_TEXT, mt, setMainLocaleSource } from '../src/main/mainText';
import { VERDICT_TEXTS, evaluateVersion } from '../src/core/djVersions';

/**
 * Testi del processo principale (finestre di sistema, errori delle guardie,
 * verdetti di versione): stesse regole dell'interfaccia. Nessun testo vuoto,
 * gli stessi segnaposto in ogni lingua — «Chiudi {app}» tradotto senza {app}
 * direbbe all'utente di chiudere qualcosa senza dire che cosa.
 */

const LOCALES = ['it', 'en', 'fr', 'de'] as const;
const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

for (const [name, dict] of [['main', MAIN_TEXT], ['verdetti', VERDICT_TEXTS]] as const) {
  describe(`testi ${name}`, () => {
    it('nessun testo vuoto, stessi segnaposto in ogni lingua', () => {
      for (const [k, v] of Object.entries(dict)) {
        for (const l of LOCALES) {
          expect(v[l]?.trim(), `${l}/${k}`).toBeTruthy();
          expect(ph(v[l]), `${l}/${k}`).toEqual(ph(v.it));
        }
      }
    });
  });
}

describe('lingua dei testi del main', () => {
  it('segue l’impostazione, con l’italiano come ripiego', () => {
    setMainLocaleSource(() => 'de');
    expect(mt('busy')).toBe('Eine andere Aufgabe läuft bereits.');
    setMainLocaleSource(() => 'xx');
    expect(mt('busy')).toBe('Un altro lavoro è già in corso.');
    setMainLocaleSource(() => null);
  });

  it('sostituisce i segnaposto', () => {
    setMainLocaleSource(() => 'en');
    expect(mt('running.open', { app: 'Traktor' })).toMatch(/^Traktor is running/);
    setMainLocaleSource(() => null);
  });

  it('i verdetti di versione parlano la lingua chiesta, senza cambiare decisione', () => {
    const it_ = evaluateVersion('traktor', null);
    const en = evaluateVersion('traktor', null, { locale: 'en' });
    expect(en.blocksWrite).toBe(it_.blocksWrite);
    expect(en.message).toMatch(/^Could not read the Traktor version/);
  });
});
