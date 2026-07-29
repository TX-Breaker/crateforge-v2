import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'fs';
import { homedir, tmpdir } from 'os';
import { join, resolve } from 'path';
import Database from 'better-sqlite3';
import { migrate } from '@core/schema';
import { importForeignLibrary } from '@core/foreignImport';
import { readEngineLibrary } from '@adapters/engine/engineReader';
import { writeEngineLibrary } from '@adapters/engine/engineWriter';

/**
 * Utility (non un test di regressione): genera la libreria Engine di prova da
 * far aprire all'utente, con i path calcolati per la posizione in cui verrà
 * effettivamente usata (CRATEFORGE_ENGINE_PATHBASE).
 *
 * Si salta sempre, tranne quando si imposta CRATEFORGE_ENGINE_OUT.
 */

// Sorgente: di norma la libreria dell'utente, ma durante una prova la sua
// posizione abituale può essere occupata dalla libreria generata — in quel caso
// si indica esplicitamente da dove leggere.
const ENGINE_DB =
  process.env.CRATEFORGE_ENGINE_SRC ?? join(homedir(), 'Music', 'Engine Library', 'Database2', 'm.db');
const OUT = process.env.CRATEFORGE_ENGINE_OUT;
const PATH_BASE = process.env.CRATEFORGE_ENGINE_PATHBASE;

describe.skipIf(!OUT || !existsSync(ENGINE_DB))('genera libreria Engine di prova', () => {
  it('scrive la libreria richiesta', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'cf-genengine-'));
    try {
      // Si legge dalla POSIZIONE REALE, non da una copia: i path dei brani
      // sono relativi alla cartella della libreria, quindi leggendo un m.db
      // copiato altrove risolverebbero rispetto alla cartella temporanea e i
      // percorsi riscritti sarebbero sbagliati. Il reader apre in sola
      // lettura, quindi l'originale non viene comunque toccato.
      const udm = new Database(':memory:');
      migrate(udm);
      importForeignLibrary(udm, readEngineLibrary(ENGINE_DB));

      const res = writeEngineLibrary(udm, OUT!, ENGINE_DB, {}, undefined, PATH_BASE);
      udm.close();
      console.log(
        `[gen] ${res.tracks} tracce, ${res.cues} cue, ${res.loops} loop → ${res.dbPath}` +
          (PATH_BASE ? ` (path relativi a ${PATH_BASE})` : '')
      );

      // Verifica dei percorsi: vanno controllati rispetto alla posizione in cui
      // la libreria verrà USATA, non a quella in cui l'abbiamo scritta —
      // altrimenti risultano tutti mancanti anche quando sono giusti.
      const finalRoot = join(PATH_BASE ?? OUT!, 'Engine Library');
      const check = new Database(res.dbPath, { readonly: true });
      const raw = (
        check.prepare('SELECT path FROM Track WHERE path IS NOT NULL LIMIT 3').all() as {
          path: string;
        }[]
      ).map((r) => r.path);
      check.close();
      console.log(`[gen] percorsi scritti, risolti da ${finalRoot}:`);
      let ok = 0;
      for (const p of raw) {
        const abs = resolve(finalRoot, p);
        const esiste = existsSync(abs);
        if (esiste) ok++;
        console.log(`[gen]   ${esiste ? 'OK   ' : 'MANCA'} ${abs}`);
      }
      expect(existsSync(res.dbPath)).toBe(true);
      expect(ok).toBe(raw.length);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }, 300_000);
});
