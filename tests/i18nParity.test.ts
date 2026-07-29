import { describe, expect, it } from 'vitest';
import { pages } from '../src/renderer/src/lib/i18nPages';
import { dict } from '../src/renderer/src/lib/i18n';

/**
 * Parità delle chiavi di traduzione: l'italiano è la fonte di verità; en/fr/de
 * devono avere ESATTAMENTE le stesse chiavi in ogni namespace. Una chiave
 * dimenticata in una lingua altrimenti produce testo mancante silenzioso.
 */
const OTHERS = ['en', 'fr', 'de'] as const;

describe('parità chiavi i18n (pagine)', () => {
  const itPages = pages.it;
  for (const ns of Object.keys(itPages)) {
    for (const loc of OTHERS) {
      it(`${ns} · ${loc} ha le stesse chiavi di it`, () => {
        const itKeys = Object.keys(itPages[ns]).sort();
        const locKeys = Object.keys(pages[loc][ns] ?? {}).sort();
        expect(locKeys).toEqual(itKeys);
      });
    }
  }
});

describe('parità chiavi i18n (nav/common/target)', () => {
  const itKeys = Object.keys(dict.it).sort();
  for (const loc of OTHERS) {
    it(`${loc} ha le stesse chiavi di it`, () => {
      expect(Object.keys(dict[loc]).sort()).toEqual(itKeys);
    });
  }
});
