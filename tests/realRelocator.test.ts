import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'child_process';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'fs';
import { homedir, tmpdir } from 'os';
import { join } from 'path';
import Database from 'better-sqlite3';
import { migrate } from '@core/schema';
import { findBrokenTracks, matchByFilename } from '@services/relocator/relocator';
import { writeRelocationXml } from '@adapters/rekordbox/relocationXml';

/**
 * Relocator sul caso REALE di questa macchina: la libreria Rekordbox punta a
 * `Desktop\BEATS\BEAT\…`, ma i file sono stati riorganizzati sotto
 * `Desktop\CREATION MUSIQUE\BEATS\` (sottocartelle BEAT HARD / BEAT SOFT).
 *
 * È lo scenario per cui il relocator esiste: nomi file invariati, alberatura
 * cambiata. Il test si auto-salta dove i dati non ci sono (CI, altre
 * macchine), così non rende rossa la pipeline.
 *
 * Sicurezza (§3): si lavora su una COPIA del master.db e l'output è un XML da
 * importare a mano; il database di Rekordbox non viene mai scritto.
 */

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

const canRun = existsSync(MASTER_DB) && existsSync(VENV_PY) && existsSync(NEW_ROOT);

let tmp: string;
let db: InstanceType<typeof Database>;

describe.skipIf(!canRun)('relocator su libreria reale spostata', () => {
  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), 'cf-reloc-real-'));
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
    db = new Database(udmPath);
  }, 320_000);

  afterAll(() => {
    db?.close();
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  it('trova i brani il cui file non esiste più al percorso salvato', () => {
    const broken = findBrokenTracks(db);
    const total = (db.prepare('SELECT COUNT(*) c FROM tracks').get() as { c: number }).c;
    console.log(`[reloc] ${broken.length} brani rotti su ${total} totali`);
    expect(broken.length).toBeGreaterThan(0);
  });

  it('ricollega i file spostati cercandoli per nome nella nuova cartella', async () => {
    const broken = findBrokenTracks(db);
    const matches = await matchByFilename(broken, NEW_ROOT);
    const found = matches.filter((m) => m.newPath !== null);
    const ambiguous = matches.filter((m) => m.ambiguous.length > 0);
    const notFound = matches.filter((m) => m.newPath === null);

    console.log(
      `[reloc] ricollegati ${found.length}/${broken.length} · ambigui ${ambiguous.length} · non trovati ${notFound.length}`
    );
    for (const m of notFound.slice(0, 5)) {
      console.log(`[reloc]   non trovato: ${m.oldPath}`);
    }
    for (const m of found.slice(0, 3)) {
      console.log(`[reloc]   ${m.track.title ?? '?'}\n[reloc]      → ${m.newPath}`);
    }

    // Il caso d'uso reale: i beat spostati devono essere ritrovati.
    expect(found.length).toBeGreaterThan(0);
    // Ogni file ritrovato deve esistere davvero sul disco.
    for (const m of found) {
      expect(existsSync(m.newPath!)).toBe(true);
    }
  }, 120_000);

  it('produce un XML di rilocazione importabile, senza toccare il master.db', async () => {
    const broken = findBrokenTracks(db);
    const matches = await matchByFilename(broken, NEW_ROOT);
    const out = join(tmp, 'relocation.xml');
    const r = writeRelocationXml(matches, out);
    console.log(`[reloc] XML: ${r.written} ricollegati, ${r.unmatched} non risolti → ${out}`);
    expect(existsSync(out)).toBe(true);
    expect(r.written).toBeGreaterThan(0);
  }, 120_000);
});
