import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { LOCALES, STRINGS } from '../src/renderer/src/lib/strings';

/**
 * Parità dei testi dell'interfaccia.
 *
 * Le chiavi sono già controllate dal compilatore (ogni lingua è tipata sulle
 * chiavi dell'italiano). Qui si controlla quello che il tipo non vede: testi
 * vuoti, segnaposto che mancano in una traduzione — «{n} brani» tradotto
 * senza «{n}» mostrerebbe una frase senza il numero — e chiavi rimaste nel
 * dizionario dopo che la schermata che le usava è sparita.
 */

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('testi dell’interfaccia', () => {
  const it_ = STRINGS.it;

  for (const { id } of LOCALES) {
    it(`${id}: nessun testo vuoto`, () => {
      for (const [k, v] of Object.entries(STRINGS[id])) {
        expect(v.trim(), `${id}/${k}`).not.toBe('');
      }
    });

    if (id === 'it') continue;
    it(`${id}: stessi segnaposto dell’italiano`, () => {
      for (const k of Object.keys(it_) as (keyof typeof it_)[]) {
        expect(placeholders(STRINGS[id][k]), `${id}/${k}`).toEqual(placeholders(it_[k]));
      }
    });
  }

  it('ogni chiave è usata da qualche parte nel codice', () => {
    const root = join(process.cwd(), 'src/renderer/src');
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(name) && !p.endsWith('strings.ts')) files.push(p);
      }
    };
    walk(root);
    const code = files.map((f) => readFileSync(f, 'utf-8')).join('\n');
    /* Le chiavi composte a runtime (`f.${campo}`, `slot.${id}`…) si
       riconoscono dal prefisso scritto nel codice come template. */
    const dynamicPrefixes = [...code.matchAll(/`([a-z][\w.]*\.)\$\{/g)].map((m) => m[1]);
    const unused = Object.keys(it_).filter(
      (k) => !code.includes(`'${k}'`) && !dynamicPrefixes.some((p) => k.startsWith(p))
    );
    expect(unused).toEqual([]);
  });
});
