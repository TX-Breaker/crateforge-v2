import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { join } from 'path';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import {
  patchSerato4Tracks,
  seratoKeyValue,
  seratoNorm
} from '../src/adapters/serato4/trackWriter';

/**
 * Aggiornamento metadati Serato 4 sul fixture sintetico.
 *
 * Il fixture replica le due difese del database reale che il patcher deve
 * superare: il trigger `after_asset_update` (con l'SSQL vero, che richiama le
 * funzioni private di Serato) e le colonne `_norm`/`key_value` precalcolate.
 * L'oracolo del patcher deve riconoscere il fixture come «biblioteca che
 * normalizza come ce l'aspettiamo» prima di toccare una riga.
 */

const TRIGGER_SQL = `CREATE TRIGGER after_asset_update
AFTER UPDATE
OF file_name, name, artist, album, genre, comments, label, remixer, grouping, composer, year, key
ON main.asset
	BEGIN
		UPDATE asset SET
			name_norm = serato_str_norm( name ),
			artist_norm = serato_str_norm( artist ),
			album_norm = serato_str_norm( album ),
			genre_norm = serato_str_norm( genre ),
			year_norm = serato_str_norm( year ),
			key_norm = serato_str_norm( key ),
			key_value = serato_raw_key_string_to_key_type( key )
		WHERE asset.id = old.id;
	END`;

function creaFixture(assets: Record<string, unknown>[]): { db: Database.Database; path: string } {
  const dir = mkdtempSync(join(tmpdir(), 'cf-serato4-'));
  const path = join(dir, 'master.sqlite');
  const db = new Database(path);
  db.exec(`
    CREATE TABLE asset (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      location_id INTEGER NOT NULL,
      portable_id TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL DEFAULT '',
      name_norm TEXT,
      artist TEXT NOT NULL DEFAULT '',
      artist_norm TEXT,
      album TEXT NOT NULL DEFAULT '',
      album_norm TEXT,
      genre TEXT NOT NULL DEFAULT '',
      genre_norm TEXT,
      year TEXT NOT NULL DEFAULT '',
      year_norm TEXT,
      key TEXT NOT NULL DEFAULT '',
      key_norm TEXT,
      key_value INTEGER NOT NULL DEFAULT -1,
      bpm REAL,
      rating REAL CHECK (rating IS NULL OR (rating BETWEEN 0 AND 1)),
      time_modified INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE updated_container (container_id INTEGER PRIMARY KEY);
    CREATE TABLE container_asset (
      asset_id INTEGER NOT NULL,
      location_container_id INTEGER NOT NULL
    );
    CREATE TABLE location_container (
      id INTEGER PRIMARY KEY,
      container_id INTEGER NOT NULL,
      location_id INTEGER NOT NULL
    );
  `);
  db.exec(TRIGGER_SQL);
  const ins = db.prepare(
    `INSERT INTO asset (id, location_id, portable_id, name, name_norm, artist, artist_norm,
       album, album_norm, genre, genre_norm, year, year_norm, key, key_norm, key_value, bpm, rating, time_modified)
     VALUES (@id, 1, 'p1', @name, @name_norm, @artist, @artist_norm, @album, @album_norm,
       @genre, @genre_norm, @year, @year_norm, @key, @key_norm, @key_value, @bpm, @rating, 1000)`
  );
  for (const a of assets) ins.run(a);
  return { db, path };
}

function riga(costruita: {
  name: string;
  artist?: string;
  album?: string;
  genre?: string;
  year?: string;
  key?: string;
}): Record<string, unknown> {
  /* Le colonne derivate sono scritte dal test con le stesse regole dell'oracolo:
     il fixture è una libreria «coerente» finché il test non dice il contrario. */
  const n = (s: string): string => seratoNorm(s);
  return {
    id: undefined,
    name: costruita.name,
    name_norm: n(costruita.name),
    artist: costruita.artist ?? '',
    artist_norm: n(costruita.artist ?? ''),
    album: costruita.album ?? '',
    album_norm: n(costruita.album ?? ''),
    genre: costruita.genre ?? '',
    genre_norm: n(costruita.genre ?? ''),
    year: costruita.year ?? '',
    year_norm: n(costruita.year ?? ''),
    key: costruita.key ?? '',
    key_norm: n(costruita.key ?? ''),
    key_value: seratoKeyValue(costruita.key ?? ''),
    bpm: null,
    rating: null
  };
}

describe('funzioni replicate di Serato 4', () => {
  it('key_value: minori 0-11 dai bemolli, maggiori 12-23, enarmonici, -1 per il vuoto', () => {
    expect(seratoKeyValue('')).toBe(-1);
    expect(seratoKeyValue(null)).toBe(-1);
    expect(seratoKeyValue('Abm')).toBe(0);
    expect(seratoKeyValue('Am')).toBe(7);
    expect(seratoKeyValue('C#m')).toBe(11);
    expect(seratoKeyValue('B')).toBe(12);
    expect(seratoKeyValue('F#')).toBe(13);
    expect(seratoKeyValue('E')).toBe(23);
    // Enarmonici accettati in entrambe le notazioni.
    expect(seratoKeyValue('Db')).toBe(14);
    expect(seratoKeyValue('C#')).toBe(14);
    expect(seratoKeyValue('G#m')).toBe(0);
    // Sconosciuto: -1, come il default della colonna.
    expect(seratoKeyValue('H')).toBe(-1);
  });

  it('norm: NFD, via i combining marks, minuscole', () => {
    expect(seratoNorm('BÀTARD')).toBe('batard');
    expect(seratoNorm('Marracash, Guè')).toBe('marracash, gue');
    expect(seratoNorm('')).toBe('');
    expect(seratoNorm(null)).toBe('');
  });
});

describe('patchSerato4Tracks', () => {
  it('aggiorna i campi e ricalcola norm e key_value', () => {
    const a = riga({ name: 'Booming', artist: 'Artista', key: 'Am', year: '2001' });
    const { db } = creaFixture([a]);
    const triggerPrima = db
      .prepare(`SELECT sql FROM sqlite_master WHERE name = 'after_asset_update'`)
      .get();
    const r = patchSerato4Tracks(
      db,
      new Map([
        [
          '1:p1',
          { title: 'Booming Remix', artist: 'Nuovo', genre: 'House', bpm: 128.5, musicalKey: 'Bb', rating: 80 }
        ]
      ])
    );
    expect(r.patched).toBe(1);
    expect(r.missing).toHaveLength(0);
    const dopo = db.prepare(`SELECT * FROM asset WHERE id = 1`).get() as Record<string, unknown>;
    expect(dopo.name).toBe('Booming Remix');
    expect(dopo.name_norm).toBe('booming remix');
    expect(dopo.artist).toBe('Nuovo');
    expect(dopo.artist_norm).toBe('nuovo');
    expect(dopo.genre).toBe('House');
    expect(dopo.genre_norm).toBe('house');
    expect(dopo.bpm).toBeCloseTo(128.5);
    expect(dopo.key).toBe('Bb');
    expect(dopo.key_value).toBe(17); // Bb: maggiore, terzo dopo B, F#, C#
    expect(dopo.key_norm).toBe('bb'); // la prima versione la lasciava vecchia
    expect(dopo.rating).toBeCloseTo(0.8); // 0-100 → REALE 0-1
    expect(dopo.year).toBe('2001'); // anno non passato: non toccato
    // Il trigger torna IDENTICO, non buttato.
    const triggerDopo = db
      .prepare(`SELECT sql FROM sqlite_master WHERE name = 'after_asset_update'`)
      .get();
    expect(triggerDopo).toEqual(triggerPrima);
    db.close();
  });

  it('enqueue le liste dei brani toccati in updated_container', () => {
    const a = riga({ name: 'Traccia' });
    const { db } = creaFixture([a]);
    db.exec(
      `INSERT INTO location_container (id, container_id, location_id) VALUES (1, 42, 1);
       INSERT INTO container_asset (asset_id, location_container_id) VALUES (1, 1);`
    );
    const r = patchSerato4Tracks(db, new Map([['1:p1', { title: 'Traccia 2' }]]));
    expect(r.patched).toBe(1);
    expect(db.prepare(`SELECT container_id FROM updated_container`).all()).toEqual([
      { container_id: 42 }
    ]);
    db.close();
  });

  it('riporta fra i missing i sourceId non risolti', () => {
    const a = riga({ name: 'Traccia' });
    const { db } = creaFixture([a]);
    const r = patchSerato4Tracks(
      db,
      new Map([
        ['1:p1', { title: 'X' }],
        ['9:p999', { title: 'Y' }]
      ])
    );
    expect(r.patched).toBe(1);
    expect(r.missing).toEqual(['9:p999']);
    db.close();
  });

  it("l'oracolo blocca la scrittura su una libreria che normalizza diversamente", () => {
    const a = riga({ name: 'Traccia', key: 'Am' });
    a.key_value = 99; // contraddizione deliberata: qui Serato «pensa» diverso da noi
    const { db } = creaFixture([a]);
    expect(() => patchSerato4Tracks(db, new Map([['1:p1', { title: 'X' }]]))).toThrow(
      /Scrittura annullata/
    );
    // Niente scritture, e il trigger è rimesso a posto.
    expect((db.prepare(`SELECT name FROM asset WHERE id = 1`).get() as { name: string }).name).toBe(
      'Traccia'
    );
    expect(
      db.prepare(`SELECT sql FROM sqlite_master WHERE name = 'after_asset_update'`).get()
    ).toBeDefined();
    db.close();
  });

  it('la tonalità si scrive nella grafia di Serato, qualunque sia quella d’origine', () => {
    const { db } = creaFixture([riga({ name: 'A', key: 'Am' }), { ...riga({ name: 'B', key: 'Am' }), portable_id: 'p2' }]);
    db.prepare(`UPDATE asset SET portable_id = 'p2' WHERE id = 2`).run();
    patchSerato4Tracks(
      db,
      new Map([
        ['1:p1', { musicalKey: 'Dbm' }], // grafia Rekordbox
        ['1:p2', { camelot: '1A', musicalKey: 'G#m' }] // grafia Engine
      ])
    );
    const k = db.prepare(`SELECT key, key_norm, key_value FROM asset ORDER BY id`).all();
    expect(k).toEqual([
      { key: 'C#m', key_norm: 'c#m', key_value: 11 },
      { key: 'Abm', key_norm: 'abm', key_value: 0 }
    ]);
    db.close();
  });

  it('il trigger di Serato non viene mai rimosso', () => {
    const { db } = creaFixture([riga({ name: 'Traccia' })]);
    const prima = db.prepare(`SELECT sql FROM sqlite_master WHERE name = 'after_asset_update'`).get();
    patchSerato4Tracks(db, new Map([['1:p1', { title: 'Nuovo' }]]));
    expect(db.prepare(`SELECT sql FROM sqlite_master WHERE name = 'after_asset_update'`).get()).toEqual(prima);
    // È il trigger di Serato, con le funzioni registrate, ad aver ricalcolato la colonna.
    expect((db.prepare(`SELECT name_norm FROM asset WHERE id = 1`).get() as { name_norm: string }).name_norm).toBe('nuovo');
    db.close();
  });

  it('un fallimento DENTRO la transazione lascia il trigger al suo posto', () => {
    const a = riga({ name: 'Buona' });
    const { db } = creaFixture([a]);
    // La coda manca: l'INSERT finale fallisce, la transazione torna indietro e
    // il rollback ripristina il trigger buttato all'inizio.
    db.exec(`DROP TABLE updated_container`);
    expect(() => patchSerato4Tracks(db, new Map([['1:p1', { title: 'X' }]]))).toThrow();
    expect(
      db.prepare(`SELECT sql FROM sqlite_master WHERE name = 'after_asset_update'`).get()
    ).toBeDefined();
    // E nessuna riga è stata toccata: il rollback ha annullato anche gli UPDATE.
    expect((db.prepare(`SELECT name FROM asset WHERE id = 1`).get() as { name: string }).name).toBe(
      'Buona'
    );
    db.close();
  });
});
