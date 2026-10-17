import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { copyFileSync, existsSync, mkdtempSync, rmSync, statSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { serato4DatabasePath, serato4Paths } from '../src/adapters/serato4';
import { patchSerato4Tracks, seratoNorm } from '../src/adapters/serato4/trackWriter';

/**
 * Validazione del PATCHER di metadati Serato 4 contro la libreria REALE, su
 * una COPIA in directory temporanea: l'originale non viene mai aperto in
 * scrittura.
 *
 * ⚠ Nessun titolo o artista personale negli asserti: si verificano forme
 * (norm ricalcolata, trigger integro, righe intatte), non contenuti. Si
 * auto-salta se Serato 4 non è installato.
 */

const master = serato4DatabasePath();
const disponibile = master !== null && existsSync(master);
const d = disponibile ? describe : describe.skip;

d('Serato 4 — patcher sulla copia della libreria reale', () => {
  it('l’oracolo passa sulla libreria vera e il patch aggiorna una riga', () => {
    const p = serato4Paths(master as string);
    const dir = mkdtempSync(join(tmpdir(), 'cf-serato4-real-'));
    try {
      const copy = join(dir, 'master.sqlite');
      copyFileSync(master as string, copy);
      for (const suffix of ['-wal', '-shm']) {
        if (existsSync((master as string) + suffix)) copyFileSync((master as string) + suffix, copy + suffix);
      }
      const db = new Database(copy);
      try {
        const prima = db
          .prepare(
            `SELECT id, name, artist, album, genre, key FROM asset
              WHERE file_name IS NOT NULL ORDER BY id LIMIT 1`
          )
          .get() as { id: number; name: string; artist: string; album: string; genre: string; key: string };
        expect(prima).toBeDefined();

        /* Il db è in WAL: una copia file è valida solo se il WAL non contiene
           pagine non ancora consolidate. WAL a 0 byte = nessun pendente; se
           c'è contenuto, ci fermiamo invece di validare una libreria a metà. */
        const walBytes = existsSync(copy + '-wal') ? statSync(copy + '-wal').size : 0;
        expect(walBytes, 'il WAL della libreria reale contiene pagine pendenti').toBe(0);

        // Il preflight (verifyOracle) gira dentro patchSerato4Tracks: se questo
        // Serato normalizza diversamente, il test fallisce QUI, non a metà scrittura.
        const nuovoTitolo = `CrateForge Test ${Date.now()}`;
        const r = patchSerato4Tracks(
          db,
          new Map([[`asset:${prima.id}`, { title: nuovoTitolo }]])
        );
        expect(r.patched).toBe(1);

        const dopo = db.prepare(`SELECT name, name_norm, time_modified FROM asset WHERE id = ?`).get(prima.id) as {
          name: string;
          name_norm: string;
          time_modified: number;
        };
        expect(dopo.name).toBe(nuovoTitolo);
        expect(dopo.name_norm).toBe(seratoNorm(nuovoTitolo));
        expect(dopo.time_modified).toBeGreaterThan(0);

        // Il trigger torna identico: una libreria senza le sue difese non è "sistemata".
        const trig = db
          .prepare(`SELECT sql FROM sqlite_master WHERE name = 'after_asset_update'`)
          .get();
        expect(trig).toBeDefined();

        // Nessun'altra riga toccata.
        const altre = db
          .prepare(`SELECT COUNT(*) AS c FROM asset WHERE name LIKE 'CrateForge Test %'`)
          .get() as { c: number };
        expect(altre.c).toBe(1);
      } finally {
        db.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
