import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { migrate, getSchemaVersion, SCHEMA_VERSION } from '@core/schema';
import { getSetting, getTracksPage, logOperation, setSetting } from '@core/udm';

/** UDM in chiaro (§11): il confine di decrittazione non entra mai qui. */
function memDb() {
  const db = new Database(':memory:');
  migrate(db);
  return db;
}

describe('schema/migrazioni', () => {
  it('porta un DB vuoto alla versione corrente ed è idempotente', () => {
    const db = memDb();
    expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION);
    migrate(db); // seconda esecuzione: nessun errore
    expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION);
  });

  it('v2: tabella relocation_matches presente e vincolata', () => {
    const db = memDb();
    db.prepare(
      `INSERT INTO tracks (source, source_id, title) VALUES ('xml', '1', 'T')`
    ).run();
    const trackId = (db.prepare(`SELECT id FROM tracks`).get() as { id: number }).id;
    db.prepare(
      `INSERT INTO relocation_matches (track_id, new_path, method) VALUES (?, ?, 'fingerprint')`
    ).run(trackId, 'C:\\new\\a.mp3');
    // UNIQUE (track_id, method): il replace non duplica
    db.prepare(
      `INSERT OR REPLACE INTO relocation_matches (track_id, new_path, method) VALUES (?, ?, 'fingerprint')`
    ).run(trackId, 'C:\\new\\b.mp3');
    const rows = db.prepare(`SELECT * FROM relocation_matches`).all() as { new_path: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].new_path).toBe('C:\\new\\b.mp3');
  });
});

describe('settings + oplog', () => {
  it('round-trip settings', () => {
    const db = memDb();
    expect(getSetting(db, 'theme')).toBeNull();
    setSetting(db, 'theme', 'dark');
    setSetting(db, 'theme', 'light'); // upsert
    expect(getSetting(db, 'theme')).toBe('light');
  });

  it('registra le operazioni', () => {
    const db = memDb();
    logOperation(db, 'test.op', '/x', 'dry-run', 'dettaglio');
    const row = db.prepare('SELECT * FROM oplog').get() as { operation: string; outcome: string };
    expect(row.operation).toBe('test.op');
    expect(row.outcome).toBe('dry-run');
  });
});

describe('getTracksPage (paginazione: mai tutta la libreria)', () => {
  it('pagina e filtra', () => {
    const db = memDb();
    const ins = db.prepare(
      `INSERT INTO tracks (source, source_id, title, artist, needs_review)
       VALUES ('xml', ?, ?, ?, ?)`
    );
    for (let i = 0; i < 25; i++) {
      ins.run(String(i), `Track ${String(i).padStart(2, '0')}`, 'Artista', i < 5 ? 1 : 0);
    }
    const page1 = getTracksPage(db, { offset: 0, limit: 10 });
    expect(page1.total).toBe(25);
    expect(page1.rows).toHaveLength(10);
    const page3 = getTracksPage(db, { offset: 20, limit: 10 });
    expect(page3.rows).toHaveLength(5);
    const review = getTracksPage(db, { offset: 0, limit: 100, needsReview: true });
    expect(review.total).toBe(5);
    const search = getTracksPage(db, { offset: 0, limit: 100, search: 'Track 07' });
    expect(search.total).toBe(1);
  });

  it('escape dei metacaratteri LIKE: % e _ non fanno da wildcard', () => {
    const db = memDb();
    const ins = db.prepare(`INSERT INTO tracks (source, source_id, title) VALUES ('xml', ?, ?)`);
    ins.run('1', '100% Pure');
    ins.run('2', '1005 Something'); // non deve matchare "100%" se % fosse wildcard
    ins.run('3', 'a_b track');
    ins.run('4', 'axb track'); // _ come wildcard matcherebbe "a_b"
    expect(getTracksPage(db, { offset: 0, limit: 100, search: '100%' }).total).toBe(1);
    expect(getTracksPage(db, { offset: 0, limit: 100, search: 'a_b' }).total).toBe(1);
  });
});

describe('getSchemaVersion validazione', () => {
  it('lancia su schema_version corrotto invece di degradare in silenzio', () => {
    const db = memDb();
    db.prepare(`UPDATE meta SET value = 'boh' WHERE key = 'schema_version'`).run();
    expect(() => getSchemaVersion(db)).toThrow(/schema_version/);
  });
});
