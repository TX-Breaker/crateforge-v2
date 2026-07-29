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
import { readTraktorNml } from '@adapters/traktor/nmlReader';
import { readVirtualDjXml } from '@adapters/virtualdj/vdjReader';
import { writeRekordboxXml } from '@adapters/rekordbox/xmlWriter';
import { writeTraktorNml } from '@adapters/traktor/nmlWriter';
import { writeVirtualDjXml } from '@adapters/virtualdj/vdjWriter';
import { writeEngineLibrary } from '@adapters/engine/engineWriter';

/**
 * MATRICE COMPLETA delle conversioni, misurata sui dati reali di questa
 * macchina: per ogni sorgente esportiamo verso ogni destinazione scrivibile e
 * RILEGGIAMO il risultato, contando cosa è arrivato davvero.
 *
 * Serve a rispondere con numeri, non con impressioni, alla domanda "cosa si
 * perde per strada". Il tabellone finisce nel log del test.
 */

const ENGINE_DB = join(homedir(), 'Music', 'Engine Library', 'Database2', 'm.db');
const SERATO_DIR = join(homedir(), 'Music', '_Serato_');
const SIDECAR_DIR = join(__dirname, '..', 'python-sidecar');
const VENV_PY =
  process.platform === 'win32'
    ? join(SIDECAR_DIR, '.venv', 'Scripts', 'python.exe')
    : join(SIDECAR_DIR, '.venv', 'bin', 'python');
const SCRIPT = join(SIDECAR_DIR, 'sidecar.py');

const canRun = existsSync(ENGINE_DB) && existsSync(VENV_PY);
const parse = (p: string) =>
  new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' }).parse(readFileSync(p, 'utf-8'));

interface Counts {
  tracks: number;
  hot: number;
  memory: number;
  loop: number;
  colored: number;
  labelled: number;
}

function countUdm(db: InstanceType<typeof Database>): Counts {
  const one = (sql: string) => (db.prepare(sql).get() as { c: number }).c;
  return {
    tracks: one('SELECT COUNT(*) c FROM tracks'),
    hot: one(`SELECT COUNT(*) c FROM cues WHERE cue_type='hot'`),
    memory: one(`SELECT COUNT(*) c FROM cues WHERE cue_type='memory'`),
    loop: one(`SELECT COUNT(*) c FROM cues WHERE cue_type='loop'`),
    colored: one(`SELECT COUNT(*) c FROM cues WHERE color IS NOT NULL`),
    labelled: one(`SELECT COUNT(*) c FROM cues WHERE label IS NOT NULL AND label <> ''`)
  };
}

const fmt = (c: Counts) =>
  `tracce ${c.tracks} · hot ${c.hot} · memory ${c.memory} · loop ${c.loop} · con colore ${c.colored} · con etichetta ${c.labelled}`;

describe.skipIf(!canRun)('matrice di conversione su dati reali', () => {
  it('misura ogni rotta sorgente → destinazione', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'cf-matrix-real-'));
    try {
      /* ---------------- sorgenti reali ---------------- */
      const sources: { name: string; load: () => InstanceType<typeof Database> }[] = [];

      sources.push({
        name: 'Engine DJ',
        load: () => {
          const copy = join(tmp, 'm_src.db');
          copyFileSync(ENGINE_DB, copy);
          const db = new Database(':memory:');
          migrate(db);
          importForeignLibrary(db, readEngineLibrary(copy));
          return db;
        }
      });

      if (existsSync(join(SERATO_DIR, 'database V2'))) {
        sources.push({
          name: 'Serato',
          load: () => {
            const udmPath = join(tmp, `serato-${Date.now()}.db`);
            const fresh = new Database(udmPath);
            migrate(fresh);
            fresh.close();
            spawnSync(
              VENV_PY,
              [SCRIPT, 'read-serato', '--udm-path', udmPath, '--serato-dir', SERATO_DIR],
              { encoding: 'utf-8', timeout: 600_000 }
            );
            return new Database(udmPath);
          }
        });
      }

      console.log('\n╔══════════════════════════════════════════════════════════════════╗');
      console.log('║  MATRICE DI CONVERSIONE — misurata sui dati reali                ║');
      console.log('╚══════════════════════════════════════════════════════════════════╝');

      for (const src of sources) {
        const db = src.load();
        const before = countUdm(db);
        console.log(`\n■ SORGENTE ${src.name}: ${fmt(before)}`);

        /* → Rekordbox XML */
        const rbPath = join(tmp, `${src.name}-rb.xml`);
        const rb = writeRekordboxXml(db, rbPath);
        const rbDoc = parse(rbPath);
        const rbMarks = (Array.isArray(rbDoc.DJ_PLAYLISTS?.COLLECTION?.TRACK)
          ? rbDoc.DJ_PLAYLISTS.COLLECTION.TRACK
          : [rbDoc.DJ_PLAYLISTS?.COLLECTION?.TRACK]
        )
          .filter(Boolean)
          .flatMap((t: Record<string, unknown>) =>
            Array.isArray(t.POSITION_MARK) ? t.POSITION_MARK : t.POSITION_MARK ? [t.POSITION_MARK] : []
          ) as Record<string, string>[];
        console.log(
          `   → Rekordbox XML : marker ${rbMarks.length} (hot-pad ${rbMarks.filter((m) => m['@_Type'] === '0' && Number(m['@_Num']) >= 0).length}, memory ${rbMarks.filter((m) => m['@_Type'] === '0' && m['@_Num'] === '-1').length}, loop ${rbMarks.filter((m) => m['@_Type'] === '4').length})${rb.warnings.length ? ' ⚠ ' + rb.warnings.join(' ') : ''}`
        );

        /* → Traktor NML (con re-import) */
        const tkPath = join(tmp, `${src.name}-tk.nml`);
        writeTraktorNml(db, tkPath);
        const tkBack = new Database(':memory:');
        migrate(tkBack);
        importForeignLibrary(tkBack, readTraktorNml(tkPath));
        const tkC = countUdm(tkBack);
        tkBack.close();
        console.log(`   → Traktor NML  : ${fmt(tkC)}`);

        /* → VirtualDJ XML (con re-import) */
        const vdjPath = join(tmp, `${src.name}-vdj.xml`);
        const vdj = writeVirtualDjXml(db, vdjPath);
        const vdjBack = new Database(':memory:');
        migrate(vdjBack);
        importForeignLibrary(vdjBack, readVirtualDjXml(vdjPath));
        const vdjC = countUdm(vdjBack);
        vdjBack.close();
        console.log(
          `   → VirtualDJ XML: ${fmt(vdjC)}${vdj.warnings.length ? ' ⚠ ' + vdj.warnings.join(' ') : ''}`
        );

        /* → Engine DJ (libreria nuova, con re-import) */
        const engOut = join(tmp, `${src.name}-engine`);
        try {
          const eng = writeEngineLibrary(db, engOut, ENGINE_DB);
          const engBack = new Database(':memory:');
          migrate(engBack);
          importForeignLibrary(engBack, readEngineLibrary(eng.dbPath));
          const engC = countUdm(engBack);
          engBack.close();
          console.log(`   → Engine DJ    : ${fmt(engC)}`);
        } catch (err) {
          console.log(`   → Engine DJ    : non generabile (${String(err).slice(0, 80)})`);
        }

        /* → Serato: scrive nei file audio, quindi qui riportiamo solo cosa
           sarebbe scrivibile (8 pad per brano), senza toccare nulla. */
        const seratoWritable = (
          db
            .prepare(
              `SELECT COUNT(*) c FROM cues WHERE cue_type='hot' AND cue_index BETWEEN 0 AND 7`
            )
            .get() as { c: number }
        ).c;
        console.log(
          `   → Serato       : ${seratoWritable} hot cue scrivibili nei tag dei file (i loop restano intatti)`
        );

        db.close();
      }

      expect(sources.length).toBeGreaterThan(0);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }, 900_000);
});
