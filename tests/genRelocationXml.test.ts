import { describe, expect, it } from 'vitest';
import { spawnSync } from 'child_process';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'fs';
import { homedir, tmpdir } from 'os';
import { join } from 'path';
import Database from 'better-sqlite3';
import { migrate } from '@core/schema';
import { findBrokenTracks, matchByFilename } from '@services/relocator/relocator';
import { writeRelocationXml } from '@adapters/rekordbox/relocationXml';

/**
 * Utility (non un test di regressione): genera l'XML di rilocazione REALE da
 * importare in Rekordbox, in una posizione stabile scelta con
 * CRATEFORGE_RELOC_OUT. Serve a produrre il file per l'utente senza passare
 * dalla UI. Si salta sempre se le variabili non sono impostate.
 */

const OUT = process.env.CRATEFORGE_RELOC_OUT;
const MASTER_DB =
  process.env.CRATEFORGE_TEST_MASTERDB ??
  (process.platform === 'win32'
    ? join(process.env.APPDATA ?? '', 'Pioneer', 'rekordbox', 'master.db')
    : join(homedir(), 'Library', 'Pioneer', 'rekordbox', 'master.db'));
const NEW_ROOT =
  process.env.CRATEFORGE_TEST_MUSICROOT ?? join(homedir(), 'Desktop', 'CREATION MUSIQUE', 'BEATS');

const SIDECAR_DIR = join(__dirname, '..', 'python-sidecar');
const VENV_PY =
  process.platform === 'win32'
    ? join(SIDECAR_DIR, '.venv', 'Scripts', 'python.exe')
    : join(SIDECAR_DIR, '.venv', 'bin', 'python');
const SCRIPT = join(SIDECAR_DIR, 'sidecar.py');

const canRun = !!OUT && existsSync(MASTER_DB) && existsSync(VENV_PY) && existsSync(NEW_ROOT);

describe.skipIf(!canRun)('genera XML di rilocazione reale', () => {
  it('scrive il file richiesto', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'cf-genreloc-'));
    try {
      const udmPath = join(tmp, 'udm.db');
      const fresh = new Database(udmPath);
      migrate(fresh);
      fresh.close();
      const copy = join(tmp, 'master_copy.db');
      copyFileSync(MASTER_DB, copy);
      spawnSync(VENV_PY, [SCRIPT, 'ingest-masterdb', '--udm-path', udmPath, '--master-db', copy], {
        encoding: 'utf-8',
        timeout: 300_000
      });
      const db = new Database(udmPath);
      const broken = findBrokenTracks(db);
      const matches = await matchByFilename(broken, NEW_ROOT);
      const r = writeRelocationXml(matches, OUT!);
      db.close();
      console.log(`[gen] ${r.written} brani ricollegati, ${r.unmatched} non risolti → ${OUT}`);
      expect(existsSync(OUT!)).toBe(true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }, 400_000);
});
