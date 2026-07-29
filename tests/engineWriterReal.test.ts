import { describe, expect, it } from 'vitest';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'fs';
import { homedir, tmpdir } from 'os';
import { join } from 'path';
import Database from 'better-sqlite3';
import { migrate } from '@core/schema';
import { importForeignLibrary } from '@core/foreignImport';
import { readEngineLibrary } from '@adapters/engine/engineReader';
import { writeEngineLibrary } from '@adapters/engine/engineWriter';

/**
 * Il giro completo su dati veri: leggiamo la libreria Engine dell'utente,
 * ne generiamo una NUOVA con il writer, e la rileggiamo con il nostro reader
 * verificando che cue e loop siano sopravvissuti.
 *
 * Se `CRATEFORGE_ENGINE_OUT` è impostata, la libreria viene generata lì e
 * lasciata sul disco: serve per aprirla in Engine DJ e validarla a mano.
 */

const ENGINE_DB = join(homedir(), 'Music', 'Engine Library', 'Database2', 'm.db');
const KEEP_OUT = process.env.CRATEFORGE_ENGINE_OUT;

describe.skipIf(!existsSync(ENGINE_DB))('writer Engine — giro completo su libreria reale', () => {
  it('rigenera una libreria con gli stessi cue e loop', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'cf-engw-'));
    const outDir = KEEP_OUT ?? join(tmp, 'out');
    try {
      // 1) leggo la libreria reale
      const src = join(tmp, 'm.db');
      copyFileSync(ENGINE_DB, src);
      const lib = readEngineLibrary(src);
      const udm = new Database(':memory:');
      migrate(udm);
      importForeignLibrary(udm, lib);
      const cuesIn = (udm.prepare('SELECT COUNT(*) c FROM cues').get() as { c: number }).c;
      const loopsIn = (
        udm.prepare(`SELECT COUNT(*) c FROM cues WHERE cue_type='loop'`).get() as { c: number }
      ).c;

      // 2) genero una libreria nuova, usando lo schema dell'installazione reale
      const res = writeEngineLibrary(udm, outDir, ENGINE_DB);
      udm.close();
      console.log(
        `[engineW] generata: ${res.tracks} tracce, ${res.cues} cue, ${res.loops} loop → ${res.dbPath}`
      );
      if (res.warnings.length) console.log(`[engineW] avvisi: ${JSON.stringify(res.warnings.slice(0, 3))}`);
      expect(existsSync(res.dbPath)).toBe(true);

      // 3) rileggo ciò che ho scritto
      const back = readEngineLibrary(res.dbPath);
      const udm2 = new Database(':memory:');
      migrate(udm2);
      importForeignLibrary(udm2, back);
      const cuesOut = (udm2.prepare('SELECT COUNT(*) c FROM cues').get() as { c: number }).c;
      const loopsOut = (
        udm2.prepare(`SELECT COUNT(*) c FROM cues WHERE cue_type='loop'`).get() as { c: number }
      ).c;
      udm2.close();
      console.log(
        `[engineW] round-trip cue ${cuesIn}→${cuesOut} · loop ${loopsIn}→${loopsOut} · tracce ${lib.tracks.length}→${back.tracks.length}`
      );

      // Il database generato dev'essere valido per SQLite…
      const check = new Database(res.dbPath, { readonly: true });
      expect((check.pragma('integrity_check') as { integrity_check: string }[])[0].integrity_check).toBe(
        'ok'
      );
      expect(check.pragma('foreign_key_check')).toEqual([]);
      check.close();

      // …e non deve perdere né cue né loop.
      expect(cuesOut).toBe(cuesIn);
      expect(loopsOut).toBe(loopsIn);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }, 300_000);
});
