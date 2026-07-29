import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'fs';
import { homedir, tmpdir } from 'os';
import { join } from 'path';
import Database from 'better-sqlite3';
import { migrate } from '@core/schema';
import { writeEngineLibrary } from '@adapters/engine/engineWriter';
import { readEngineLibrary } from '@adapters/engine/engineReader';

/**
 * Playlist verso Engine DJ: nel database sono due liste concatenate
 * (`nextListId` tra playlist, `nextEntityId` tra brani, zero come terminatore).
 * Qui verifichiamo che l'ordine sopravviva al giro completo, perché una
 * scaletta con i brani mescolati è peggio di una scaletta assente.
 */

const ENGINE_DB = join(homedir(), 'Music', 'Engine Library', 'Database2', 'm.db');

describe.skipIf(!existsSync(ENGINE_DB))('playlist verso Engine DJ', () => {
  it('scrive le playlist conservando l\'ordine dei brani', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'cf-engpl-'));
    try {
      const udm = new Database(':memory:');
      migrate(udm);

      // Libreria minima: 3 brani in una cartella reale, così i path relativi
      // sono calcolabili.
      const base = join(homedir(), 'Music');
      const ids: number[] = [];
      for (const n of ['uno', 'due', 'tre']) {
        const info = udm
          .prepare(
            `INSERT INTO tracks (source, source_id, title, artist, path, bpm, duration_s)
             VALUES ('xml', ?, ?, 'Tester', ?, 120, 180)`
          )
          .run(n, n.toUpperCase(), join(base, `${n}.mp3`));
        ids.push(Number(info.lastInsertRowid));
      }
      // Playlist con i brani in ordine INVERSO: se l'ordine non fosse
      // preservato, il test non se ne accorgerebbe usando l'ordine naturale.
      const pl = udm
        .prepare(
          `INSERT INTO playlists (source, source_id, name, is_folder, sort_order)
           VALUES ('xml', 'p1', 'Scaletta Prova', 0, 0)`
        )
        .run();
      const plId = Number(pl.lastInsertRowid);
      const order = [ids[2], ids[0], ids[1]];
      order.forEach((tid, i) => {
        udm
          .prepare(
            `INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)`
          )
          .run(plId, tid, i);
      });

      const res = writeEngineLibrary(udm, join(tmp, 'out'), ENGINE_DB, {}, undefined, base);
      udm.close();
      console.log(`[engPl] scritte ${res.playlists} playlist, ${res.tracks} brani`);
      expect(res.playlists).toBe(1);

      // Rilettura: la playlist c'è e i brani sono nell'ordine giusto?
      const back = readEngineLibrary(res.dbPath);
      const list = back.playlists.find((p) => p.name === 'Scaletta Prova');
      console.log(`[engPl] riletta: ${list ? list.trackSourceIds.length + ' brani' : 'NON TROVATA'}`);
      expect(list).toBeDefined();
      expect(list!.trackSourceIds.length).toBe(3);

      // L'ordine dei titoli deve essere TRE, UNO, DUE.
      const byId = new Map(back.tracks.map((t) => [t.sourceId, t.title]));
      const titles = list!.trackSourceIds.map((sid) => byId.get(sid));
      console.log(`[engPl] ordine riletto: ${titles.join(' → ')}`);
      expect(titles).toEqual(['TRE', 'UNO', 'DUE']);

      // Il database dev'essere comunque valido.
      const check = new Database(res.dbPath, { readonly: true });
      expect((check.pragma('integrity_check') as { integrity_check: string }[])[0].integrity_check).toBe('ok');
      expect(check.pragma('foreign_key_check')).toEqual([]);
      check.close();
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }, 180_000);
});
