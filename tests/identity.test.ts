import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { migrate, SCHEMA_VERSION } from '@core/schema';
import { linkCanonicalTracks, sourcesPerCanonical } from '@core/identity';

/**
 * Identità della traccia fra software diversi.
 *
 * Il rischio di questa funzione non è che colleghi poco: è che colleghi TROPPO.
 * Unire due righe che non sono lo stesso file significa, più avanti, scrivere i
 * cue di un brano dentro un altro. Metà dei test qui sotto servono a questo: a
 * dimostrare che i casi ambigui restano separati.
 */

function memDb() {
  const db = new Database(':memory:');
  migrate(db);
  return db;
}

interface T {
  source: string;
  source_id: string;
  title?: string;
  path?: string | null;
  filesize?: number | null;
  duration_s?: number | null;
  acoustic_id?: string | null;
}

function add(db: Database.Database, t: T): number {
  return Number(
    db
      .prepare(
        `INSERT INTO tracks (source, source_id, title, path, filesize, duration_s, acoustic_id)
         VALUES (@source, @source_id, @title, @path, @filesize, @duration_s, @acoustic_id)`
      )
      .run({
        title: t.title ?? 'T',
        path: t.path ?? null,
        filesize: t.filesize ?? null,
        duration_s: t.duration_s ?? null,
        acoustic_id: t.acoustic_id ?? null,
        ...t
      }).lastInsertRowid
  );
}

const canonicalOf = (db: Database.Database, id: number): number =>
  (db.prepare(`SELECT COALESCE(canonical_id, id) k FROM tracks WHERE id = ?`).get(id) as {
    k: number;
  }).k;

describe('schema v7', () => {
  it('porta il database alla versione con l identità canonica', () => {
    const db = memDb();
    /* La versione va avanti a ogni migrazione: qui interessa che sia arrivata
       ALMENO all'identità canonica, non che si sia fermata lì. Un test che
       fissa il numero esatto si rompe a ogni schema nuovo senza che niente si
       sia rotto davvero. */
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(7);
    const cols = (db.prepare('PRAGMA table_info(tracks)').all() as { name: string }[]).map(
      (c) => c.name
    );
    expect(cols).toContain('canonical_id');
  });

  it('le righe esistenti restano il proprio canonico: nessun dato rimescolato', () => {
    const db = memDb();
    const a = add(db, { source: 'masterdb', source_id: '1', path: 'C:/M/a.mp3' });
    // Nessuna chiamata a linkCanonicalTracks: è lo stato di chi aggiorna l'app.
    expect(canonicalOf(db, a)).toBe(a);
    expect(
      (db.prepare('SELECT canonical_id FROM tracks WHERE id = ?').get(a) as {
        canonical_id: number | null;
      }).canonical_id
    ).toBeNull();
  });
});

describe('regola 1 — stesso percorso', () => {
  it('unisce lo stesso file visto da due software', () => {
    const db = memDb();
    const rb = add(db, { source: 'masterdb', source_id: '1', path: 'C:/Musica/track.mp3' });
    const tr = add(db, { source: 'traktor', source_id: 'x', path: 'C:/Musica/track.mp3' });
    const r = linkCanonicalTracks(db);
    expect(r.linked).toBe(1);
    expect(r.byRule.path).toBe(1);
    expect(canonicalOf(db, tr)).toBe(rb);
    expect(sourcesPerCanonical(db, rb).sort()).toEqual(['masterdb', 'traktor']);
  });

  it('ignora maiuscole e forma unicode: è lo stesso file per il filesystem', () => {
    const db = memDb();
    const a = add(db, { source: 'masterdb', source_id: '1', path: 'C:/Musica/Caffè.mp3' });
    const b = add(db, {
      source: 'virtualdj',
      source_id: 'y',
      path: 'C:/MUSICA/Caffè.mp3'.normalize('NFD')
    });
    linkCanonicalTracks(db);
    expect(canonicalOf(db, b)).toBe(a);
  });

  it('tre software sullo stesso file convergono su un canonico solo', () => {
    const db = memDb();
    const a = add(db, { source: 'masterdb', source_id: '1', path: 'C:/M/x.mp3' });
    const b = add(db, { source: 'traktor', source_id: '2', path: 'C:/M/x.mp3' });
    const c = add(db, { source: 'virtualdj', source_id: '3', path: 'C:/M/x.mp3' });
    linkCanonicalTracks(db);
    expect(canonicalOf(db, b)).toBe(a);
    expect(canonicalOf(db, c)).toBe(a);
    expect(sourcesPerCanonical(db, a)).toHaveLength(3);
  });
});

describe('regola 2 — nome, dimensione e durata insieme', () => {
  it('unisce lo stesso file su percorsi diversi', () => {
    const db = memDb();
    const a = add(db, {
      source: 'masterdb',
      source_id: '1',
      path: 'C:/Musica/brano.mp3',
      filesize: 8_412_000,
      duration_s: 214.4
    });
    const b = add(db, {
      source: 'serato',
      source_id: '2',
      path: 'D:/Backup/Musica/brano.mp3',
      filesize: 8_412_000,
      duration_s: 214.6
    });
    const r = linkCanonicalTracks(db);
    expect(canonicalOf(db, b)).toBe(a);
    expect(r.byRule.fileMatch).toBe(1);
  });

  it('NON unisce due file con lo stesso nome ma dimensione diversa', () => {
    const db = memDb();
    const a = add(db, {
      source: 'masterdb',
      source_id: '1',
      path: 'C:/A/intro.mp3',
      filesize: 5_000_000,
      duration_s: 120
    });
    const b = add(db, {
      source: 'traktor',
      source_id: '2',
      path: 'C:/B/intro.mp3',
      filesize: 9_100_000,
      duration_s: 120
    });
    linkCanonicalTracks(db);
    expect(canonicalOf(db, b)).toBe(b);
  });

  it('NON unisce due master diversi dello stesso brano', () => {
    /* Titolo e artista identici, durata quasi uguale, ma file diversi: è il
       caso della stessa canzone in due compilation. Unirli significherebbe
       scrivere i cue di un master sull'altro. */
    const db = memDb();
    const a = add(db, {
      source: 'masterdb',
      source_id: '1',
      title: 'One More Time',
      path: 'C:/A/one more time.mp3',
      filesize: 8_000_000,
      duration_s: 320.1
    });
    const b = add(db, {
      source: 'traktor',
      source_id: '2',
      title: 'One More Time',
      path: 'C:/B/one_more_time (remaster).mp3',
      filesize: 8_400_000,
      duration_s: 320.4
    });
    linkCanonicalTracks(db);
    expect(canonicalOf(db, b)).toBe(b);
  });

  it('senza dimensione o senza durata la regola 2 non scatta', () => {
    const db = memDb();
    add(db, { source: 'masterdb', source_id: '1', path: 'C:/A/y.mp3', filesize: 1000 });
    const b = add(db, { source: 'traktor', source_id: '2', path: 'C:/B/y.mp3', filesize: 1000 });
    linkCanonicalTracks(db);
    expect(canonicalOf(db, b)).toBe(b);
  });
});

describe('regola 3 — impronta acustica', () => {
  it('unisce due file diversi con la stessa impronta', () => {
    const db = memDb();
    const a = add(db, {
      source: 'masterdb',
      source_id: '1',
      path: 'C:/A/a.mp3',
      acoustic_id: 'abc123'
    });
    const b = add(db, {
      source: 'virtualdj',
      source_id: '2',
      path: 'D:/B/rinominato.mp3',
      acoustic_id: 'abc123'
    });
    const r = linkCanonicalTracks(db);
    expect(canonicalOf(db, b)).toBe(a);
    expect(r.byRule.acoustic).toBe(1);
  });
});

describe('comportamento generale', () => {
  it('è idempotente: rieseguirla non cambia niente', () => {
    const db = memDb();
    const a = add(db, { source: 'masterdb', source_id: '1', path: 'C:/M/z.mp3' });
    const b = add(db, { source: 'traktor', source_id: '2', path: 'C:/M/z.mp3' });
    const first = linkCanonicalTracks(db);
    const second = linkCanonicalTracks(db);
    expect(first.linked).toBe(1);
    expect(second.linked).toBe(0);
    expect(canonicalOf(db, b)).toBe(a);
  });

  it('non unisce mai due righe della STESSA sorgente per errore di percorso nullo', () => {
    const db = memDb();
    const a = add(db, { source: 'traktor', source_id: '1', path: null });
    const b = add(db, { source: 'traktor', source_id: '2', path: null });
    linkCanonicalTracks(db);
    expect(canonicalOf(db, a)).toBe(a);
    expect(canonicalOf(db, b)).toBe(b);
  });

  it('conta i brani presenti in più software', () => {
    const db = memDb();
    add(db, { source: 'masterdb', source_id: '1', path: 'C:/M/1.mp3' });
    add(db, { source: 'traktor', source_id: '2', path: 'C:/M/1.mp3' });
    add(db, { source: 'traktor', source_id: '3', path: 'C:/M/solo-traktor.mp3' });
    const r = linkCanonicalTracks(db);
    expect(r.shared).toBe(1);
  });
});
