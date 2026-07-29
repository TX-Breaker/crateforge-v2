import { describe, expect, it } from 'vitest';
import { spawnSync } from 'child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { homedir, tmpdir } from 'os';
import { join } from 'path';
import { XMLParser } from 'fast-xml-parser';
import Database from 'better-sqlite3';
import { migrate } from '@core/schema';
import { importForeignLibrary } from '@core/foreignImport';
import { readEngineLibrary } from '@adapters/engine/engineReader';
import { writeRekordboxXml } from '@adapters/rekordbox/xmlWriter';
import { writeTraktorNml } from '@adapters/traktor/nmlWriter';
import { writeVirtualDjXml } from '@adapters/virtualdj/vdjWriter';

/**
 * Conversione INCROCIATA sui cue REALI messi a mano dall'utente.
 *
 * Non basta leggere i cue: il punto del prodotto è portarli da un programma
 * all'altro. Qui prendiamo i cue veri di Engine DJ e di Serato su questa
 * macchina e verifichiamo che arrivino interi in Rekordbox XML, Traktor NML e
 * VirtualDJ XML — contandoli nel file scritto, non fidandoci del valore di
 * ritorno.
 */

const ENGINE_DB = join(homedir(), 'Music', 'Engine Library', 'Database2', 'm.db');
const SERATO_DIR = join(homedir(), 'Music', '_Serato_');
const SIDECAR_DIR = join(__dirname, '..', 'python-sidecar');
const VENV_PY =
  process.platform === 'win32'
    ? join(SIDECAR_DIR, '.venv', 'Scripts', 'python.exe')
    : join(SIDECAR_DIR, '.venv', 'bin', 'python');
const SCRIPT = join(SIDECAR_DIR, 'sidecar.py');

const parse = (p: string) =>
  new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' }).parse(readFileSync(p, 'utf-8'));
const arr = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

/** Cue nel file, contati sul documento scritto. */
function countInFiles(db: InstanceType<typeof Database>, tmp: string, tag: string) {
  const rbPath = join(tmp, 'out.xml');
  const tkPath = join(tmp, 'out.nml');
  const vdjPath = join(tmp, 'out_vdj.xml');
  writeRekordboxXml(db, rbPath);
  writeTraktorNml(db, tkPath);
  const vdjRes = writeVirtualDjXml(db, vdjPath);

  const rbMarks = arr<Record<string, unknown>>(parse(rbPath).DJ_PLAYLISTS?.COLLECTION?.TRACK).flatMap(
    (t) => arr<Record<string, string>>(t.POSITION_MARK as never)
  );
  const tkCues = arr<Record<string, unknown>>(parse(tkPath).NML?.COLLECTION?.ENTRY).flatMap((e) =>
    arr<Record<string, string>>(e.CUE_V2 as never)
  );
  // I marker di griglia (TYPE 4) non sono cue dell'utente: si escludono.
  const tkUserCues = tkCues.filter((c) => c['@_TYPE'] !== '4');
  const vdjPois = arr<Record<string, unknown>>(parse(vdjPath).VirtualDJ_Database?.Song).flatMap((s) =>
    arr<Record<string, string>>(s.Poi as never)
  );

  const source = (db.prepare('SELECT COUNT(*) c FROM cues').get() as { c: number }).c;
  console.log(
    `[${tag}] cue nel pivot: ${source} → rekordbox ${rbMarks.length} · traktor ${tkUserCues.length} · virtualdj ${vdjPois.length}`
  );
  if (vdjRes.warnings.length) console.log(`[${tag}] warning VDJ: ${JSON.stringify(vdjRes.warnings)}`);
  return { source, rb: rbMarks.length, tk: tkUserCues.length, vdj: vdjPois.length };
}

describe.skipIf(!existsSync(ENGINE_DB))('Engine DJ → tutti i formati (cue reali)', () => {
  it('porta i cue di Engine dentro Rekordbox, Traktor e VirtualDJ', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'cf-x-engine-'));
    try {
      const copy = join(tmp, 'm.db');
      copyFileSync(ENGINE_DB, copy);
      const db = new Database(':memory:');
      migrate(db);
      importForeignLibrary(db, readEngineLibrary(copy));

      const r = countInFiles(db, tmp, 'engine→X');
      db.close();

      expect(r.source).toBeGreaterThan(0);
      // Nessuna rotta deve perdere cue per strada.
      expect(r.rb).toBeGreaterThanOrEqual(r.source);
      expect(r.tk).toBeGreaterThanOrEqual(r.source);
      expect(r.vdj).toBeGreaterThanOrEqual(r.source);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }, 180_000);
});

describe.skipIf(!existsSync(VENV_PY) || !existsSync(join(SERATO_DIR, 'database V2')))(
  'Serato → tutti i formati (cue reali)',
  () => {
    it('porta i cue di Serato dentro Rekordbox, Traktor e VirtualDJ', () => {
      const tmp = mkdtempSync(join(tmpdir(), 'cf-x-serato-'));
      try {
        const udmPath = join(tmp, 'udm.db');
        const fresh = new Database(udmPath);
        migrate(fresh);
        fresh.close();
        spawnSync(VENV_PY, [SCRIPT, 'read-serato', '--udm-path', udmPath, '--serato-dir', SERATO_DIR], {
          encoding: 'utf-8',
          timeout: 600_000
        });

        const db = new Database(udmPath);
        const r = countInFiles(db, tmp, 'serato→X');
        db.close();

        expect(r.source).toBeGreaterThan(0);
        expect(r.rb).toBeGreaterThanOrEqual(r.source);
        expect(r.tk).toBeGreaterThanOrEqual(r.source);
        expect(r.vdj).toBeGreaterThanOrEqual(r.source);
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    }, 620_000);
  }
);
