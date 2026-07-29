import { describe, expect, it } from 'vitest';
import { spawnSync } from 'child_process';
import { copyFileSync, cpSync, existsSync, mkdtempSync, rmSync } from 'fs';
import { homedir, tmpdir } from 'os';
import { join } from 'path';
import Database from 'better-sqlite3';
import { migrate } from '@core/schema';
import { importForeignLibrary } from '@core/foreignImport';
import { readEngineLibrary } from '@adapters/engine/engineReader';

/**
 * Lettura dei CUE REALI messi a mano dall'utente in Engine DJ e in Serato su
 * questa macchina. È la prova che i reader funzionano su dati veri, non solo
 * su fixture: due tracce per programma, con tutti i tipi di punto.
 *
 * Si auto-salta dove le librerie non esistono, così la CI resta verde.
 * Sicurezza (§3): le librerie vengono COPIATE prima di essere aperte.
 */

const ENGINE_DB = join(homedir(), 'Music', 'Engine Library', 'Database2', 'm.db');
const SERATO_MUSIC_ROOT =
  process.env.CRATEFORGE_TEST_MUSICROOT ?? join(homedir(), 'Desktop', 'CREATION MUSIQUE', 'BEATS');

const SIDECAR_DIR = join(__dirname, '..', 'python-sidecar');
const VENV_PY =
  process.platform === 'win32'
    ? join(SIDECAR_DIR, '.venv', 'Scripts', 'python.exe')
    : join(SIDECAR_DIR, '.venv', 'bin', 'python');
const SCRIPT = join(SIDECAR_DIR, 'sidecar.py');

describe.skipIf(!existsSync(ENGINE_DB))('Engine DJ — cue reali', () => {
  it('legge tracce e cue dal m.db creato su questa macchina', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'cf-engine-'));
    try {
      // Copia dell'intera cartella Database2: il reader risale alla libreria.
      const dbCopy = join(tmp, 'm.db');
      copyFileSync(ENGINE_DB, dbCopy);

      const lib = readEngineLibrary(dbCopy);
      const cues = lib.tracks.flatMap((t) => t.cues ?? []);
      const byType = cues.reduce<Record<string, number>>((acc, c) => {
        acc[c.type] = (acc[c.type] ?? 0) + 1;
        return acc;
      }, {});
      console.log(
        `[engine] ${lib.tracks.length} tracce, ${cues.length} cue — per tipo: ${JSON.stringify(byType)}`
      );
      for (const t of lib.tracks.slice(0, 4)) {
        console.log(
          `[engine]   ${t.artist ?? '?'} – ${t.title ?? '?'} | bpm ${t.bpm ?? '?'} | cue ${(t.cues ?? []).length}`
        );
        for (const c of (t.cues ?? []).slice(0, 10)) {
          console.log(
            `[engine]      ${c.type} idx=${c.index ?? '-'} @${Math.round(c.positionMs)}ms ${c.color ?? ''} ${c.label ?? ''}`
          );
        }
      }
      if (lib.warnings.length) console.log(`[engine] warning: ${JSON.stringify(lib.warnings)}`);

      expect(lib.tracks.length).toBeGreaterThan(0);
      // L'utente ha messo i cue a mano: devono arrivare fino a noi.
      expect(cues.length).toBeGreaterThan(0);

      // E devono entrare nell'UDM senza perdersi.
      const db = new Database(':memory:');
      migrate(db);
      const res = importForeignLibrary(db, lib);
      const stored = (db.prepare('SELECT COUNT(*) c FROM cues').get() as { c: number }).c;
      console.log(`[engine] importati: ${res.tracks} tracce, ${stored} cue nell'UDM`);
      db.close();
      expect(stored).toBe(cues.length);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }, 120_000);
});

const SERATO_DIR = join(homedir(), 'Music', '_Serato_');

describe.skipIf(!existsSync(VENV_PY) || !existsSync(join(SERATO_DIR, 'database V2')))(
  'Serato — libreria database V2',
  () => {
    it('legge la libreria e i cue dal database V2 di Serato', () => {
      const tmp = mkdtempSync(join(tmpdir(), 'cf-seratodb-'));
      try {
        const udmPath = join(tmp, 'udm.db');
        const fresh = new Database(udmPath);
        migrate(fresh);
        fresh.close();

        // Copia della cartella _Serato_ (mai lavorare sull'originale, §3).
        const copyDir = join(tmp, '_Serato_');
        cpSync(SERATO_DIR, copyDir, { recursive: true });

        const r = spawnSync(
          VENV_PY,
          [SCRIPT, 'read-serato', '--udm-path', udmPath, '--serato-dir', copyDir],
          { encoding: 'utf-8', timeout: 600_000 }
        );
        const events = (r.stdout ?? '')
          .split('\n')
          .filter((l) => l.trim().startsWith('{'))
          .map((l) => JSON.parse(l) as { type: string; data?: Record<string, number>; message?: string });
        const done = events.find((e) => e.type === 'done');
        const err = events.find((e) => e.type === 'error');
        if (err) console.log(`[seratoDB] errore: ${err.message}`);
        console.log(`[seratoDB] esito: ${JSON.stringify(done?.data ?? {})}`);

        const db = new Database(udmPath);
        const tracks = (
          db.prepare(`SELECT COUNT(*) c FROM tracks WHERE source='serato'`).get() as { c: number }
        ).c;
        const cues = (db.prepare('SELECT COUNT(*) c FROM cues').get() as { c: number }).c;
        const playlists = (
          db.prepare(`SELECT COUNT(*) c FROM playlists WHERE source='serato'`).get() as { c: number }
        ).c;
        console.log(`[seratoDB] ${tracks} tracce, ${cues} cue, ${playlists} crate`);
        for (const row of db
          .prepare(
            `SELECT t.title, t.artist, COUNT(c.id) n FROM tracks t
             LEFT JOIN cues c ON c.track_id = t.id
             WHERE t.source='serato' GROUP BY t.id HAVING n > 0`
          )
          .all() as { title: string; artist: string; n: number }[]) {
          console.log(`[seratoDB]   ${row.artist ?? '?'} – ${row.title ?? '?'}: ${row.n} cue`);
        }
        db.close();
        expect(tracks).toBeGreaterThan(0);
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    }, 620_000);
  }
);

describe.skipIf(!existsSync(VENV_PY) || !existsSync(SERATO_MUSIC_ROOT))('Serato — cue reali', () => {
  it('legge i GEOB "Serato Markers2" dai file taggati a mano', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'cf-serato-'));
    try {
      const udmPath = join(tmp, 'udm.db');
      const fresh = new Database(udmPath);
      migrate(fresh);
      fresh.close();

      const r = spawnSync(
        VENV_PY,
        [SCRIPT, 'read-serato', '--udm-path', udmPath, '--serato-dir', SERATO_MUSIC_ROOT],
        { encoding: 'utf-8', timeout: 600_000 }
      );
      const events = (r.stdout ?? '')
        .split('\n')
        .filter((l) => l.trim().startsWith('{'))
        .map((l) => JSON.parse(l) as { type: string; data?: Record<string, number>; message?: string });
      const done = events.find((e) => e.type === 'done');
      const err = events.find((e) => e.type === 'error');
      if (err) console.log(`[serato] errore: ${err.message}`);
      console.log(`[serato] esito: ${JSON.stringify(done?.data ?? {})}`);

      const db = new Database(udmPath);
      const tracks = (db.prepare(`SELECT COUNT(*) c FROM tracks WHERE source='serato'`).get() as {
        c: number;
      }).c;
      const cues = (db.prepare('SELECT COUNT(*) c FROM cues').get() as { c: number }).c;
      const byType = db
        .prepare('SELECT cue_type, COUNT(*) n FROM cues GROUP BY cue_type')
        .all() as { cue_type: string; n: number }[];
      console.log(`[serato] ${tracks} tracce con marker, ${cues} cue — ${JSON.stringify(byType)}`);
      for (const row of db
        .prepare(
          `SELECT t.title, t.artist, COUNT(c.id) n FROM tracks t
           LEFT JOIN cues c ON c.track_id = t.id
           WHERE t.source='serato' GROUP BY t.id HAVING n > 0 LIMIT 5`
        )
        .all() as { title: string; artist: string; n: number }[]) {
        console.log(`[serato]   ${row.artist ?? '?'} – ${row.title ?? '?'}: ${row.n} cue`);
      }
      db.close();

      expect(cues).toBeGreaterThan(0);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }, 620_000);
});
