import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'child_process';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'fs';
import { homedir, tmpdir } from 'os';
import { join } from 'path';
import Database from 'better-sqlite3';
import { migrate } from '@core/schema';
import { writeRekordboxXml } from '@adapters/rekordbox/xmlWriter';
import { writeTraktorNml } from '@adapters/traktor/nmlWriter';
import { writeVirtualDjXml } from '@adapters/virtualdj/vdjWriter';
import { importForeignLibrary } from '@core/foreignImport';
import { readTraktorNml } from '@adapters/traktor/nmlReader';
import { readVirtualDjXml } from '@adapters/virtualdj/vdjReader';

/**
 * Round-trip sulla LIBRERIA REALE di Rekordbox installata su questa macchina.
 *
 * Perché serve: le fixture sintetiche non catturano ciò che rompe davvero
 * (cue non contigui, path con caratteri strani, campi assenti su migliaia di
 * brani). Questo test legge il master.db vero, esporta verso i tre formati
 * scrivibili e RILEGGE ciò che ha scritto, verificando che i cue sopravvivano.
 *
 * Si auto-salta dove il master.db non c'è (CI, altre macchine): il valore è
 * sulla macchina di sviluppo, non deve rendere rossa la pipeline.
 *
 * Sicurezza (§3): il master.db viene COPIATO e la copia è l'unica cosa che
 * tocchiamo; l'originale non viene mai aperto in scrittura.
 */

const MASTER_DB =
  process.env.CRATEFORGE_TEST_MASTERDB ??
  (process.platform === 'win32'
    ? join(process.env.APPDATA ?? '', 'Pioneer', 'rekordbox', 'master.db')
    : join(homedir(), 'Library', 'Pioneer', 'rekordbox', 'master.db'));

const SIDECAR_DIR = join(__dirname, '..', 'python-sidecar');
const VENV_PY =
  process.platform === 'win32'
    ? join(SIDECAR_DIR, '.venv', 'Scripts', 'python.exe')
    : join(SIDECAR_DIR, '.venv', 'bin', 'python');
const SCRIPT = join(SIDECAR_DIR, 'sidecar.py');

const canRun = existsSync(MASTER_DB) && existsSync(VENV_PY);

let tmp: string;
let udmPath: string;
let db: InstanceType<typeof Database>;
let ingested = { tracks: 0, cues: 0 };

describe.skipIf(!canRun)('round-trip su libreria Rekordbox reale', () => {
  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), 'cf-real-'));
    udmPath = join(tmp, 'udm.db');
    // L'UDM deve esistere e essere migrato PRIMA dello spawn del sidecar (§2).
    const fresh = new Database(udmPath);
    migrate(fresh);
    fresh.close();

    // Copia del master.db: mai lavorare sull'originale.
    const copy = join(tmp, 'master_copy.db');
    copyFileSync(MASTER_DB, copy);

    const r = spawnSync(
      VENV_PY,
      [SCRIPT, 'ingest-masterdb', '--udm-path', udmPath, '--master-db', copy],
      { encoding: 'utf-8', timeout: 300_000 }
    );
    const events = (r.stdout ?? '')
      .split('\n')
      .filter((l) => l.trim().startsWith('{'))
      .map((l) => JSON.parse(l) as { type: string; data?: Record<string, number>; message?: string });
    const done = events.find((e) => e.type === 'done');
    const err = events.find((e) => e.type === 'error');
    if (err) console.warn('[lab] ingest error:', err.message);
    ingested = {
      tracks: Number(done?.data?.tracks ?? 0),
      cues: Number(done?.data?.cues ?? 0)
    };
    db = new Database(udmPath);
  }, 320_000);

  afterAll(() => {
    db?.close();
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  it('importa la libreria reale con brani e cue', () => {
    const tracks = (db.prepare('SELECT COUNT(*) c FROM tracks').get() as { c: number }).c;
    const cues = (db.prepare('SELECT COUNT(*) c FROM cues').get() as { c: number }).c;
    console.log(`[lab] libreria reale: ${tracks} brani, ${cues} cue (ingest: ${JSON.stringify(ingested)})`);
    expect(tracks).toBeGreaterThan(0);
  });

  it('esporta verso i tre formati senza perdere brani con percorso', () => {
    const withPath = (
      db.prepare('SELECT COUNT(*) c FROM tracks WHERE path IS NOT NULL').get() as { c: number }
    ).c;

    const rb = writeRekordboxXml(db, join(tmp, 'out_rb.xml'));
    const tk = writeTraktorNml(db, join(tmp, 'out_tk.nml'));
    const vdj = writeVirtualDjXml(db, join(tmp, 'out_vdj.xml'));
    console.log(
      `[lab] export — rekordbox:${rb.tracks} traktor:${tk.tracks} virtualdj:${vdj.tracks} (brani con path: ${withPath})`
    );
    console.log(`[lab] warning VDJ: ${JSON.stringify(vdj.warnings)}`);

    // I writer che filtrano sul path devono esportarli tutti.
    expect(tk.tracks).toBe(withPath);
    expect(vdj.tracks).toBe(withPath);
    expect(rb.tracks).toBeGreaterThan(0);
  });

  it('ri-legge il proprio export VirtualDJ conservando i cue (round-trip)', () => {
    const outPath = join(tmp, 'rt_vdj.xml');
    const written = writeVirtualDjXml(db, outPath);
    const cuesBefore = (
      db.prepare(
        `SELECT COUNT(*) c FROM cues WHERE cue_type IN ('hot','memory')
         AND track_id IN (SELECT id FROM tracks WHERE path IS NOT NULL)`
      ).get() as { c: number }
    ).c;

    // Re-import in un UDM pulito: è il giro completo CrateForge → VDJ → CrateForge.
    const back = new Database(join(tmp, 'udm_back.db'));
    migrate(back);
    const res = importForeignLibrary(back, readVirtualDjXml(outPath));
    const cuesAfter = (
      back.prepare(`SELECT COUNT(*) c FROM cues WHERE cue_type IN ('hot','memory')`).get() as {
        c: number;
      }
    ).c;
    console.log(
      `[lab] round-trip VDJ — brani ${written.tracks}→${res.tracks}, cue hot+memory ${cuesBefore}→${cuesAfter}`
    );
    back.close();

    // Prima del fix le memory cue sparivano: qui verifichiamo che il conto
    // non crolli (tolleranza sui soli hot cue oltre i pad disponibili).
    expect(res.tracks).toBe(written.tracks);
    expect(cuesAfter).toBeGreaterThanOrEqual(cuesBefore);
  });

  it('ri-legge il proprio export Traktor conservando i brani', () => {
    const outPath = join(tmp, 'rt_tk.nml');
    const written = writeTraktorNml(db, outPath);
    const back = new Database(join(tmp, 'udm_back_tk.db'));
    migrate(back);
    const res = importForeignLibrary(back, readTraktorNml(outPath));
    const cues = (back.prepare('SELECT COUNT(*) c FROM cues').get() as { c: number }).c;
    console.log(`[lab] round-trip Traktor — brani ${written.tracks}→${res.tracks}, cue riletti ${cues}`);
    if (res.warnings?.length) console.log(`[lab] warning Traktor: ${JSON.stringify(res.warnings)}`);
    back.close();
    expect(res.tracks).toBe(written.tracks);
  });
});
