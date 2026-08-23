import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { migrate } from '../src/core/schema';
import { applySync, planLibrarySync, type SyncOptions } from '../src/core/syncEngine';
import type { SyncField } from '../src/core/syncDiff';

/**
 * Il motore, sull'archivio interno.
 *
 * ⚠ Questi test non toccano nessuna libreria di terze parti, ed è esattamente
 * il punto: la riconciliazione è una fase separata dalla propagazione. Qui si
 * dimostra che le decisioni sono giuste; la scrittura verso i software DJ passa
 * dagli export, che hanno le loro guardie e i loro test.
 */

const CAMPI: SyncField[] = ['genre', 'bpm', 'musical_key', 'rating'];

function udm() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = OFF');
  migrate(db);
  db.pragma('foreign_keys = ON');
  return db;
}

/** Due righe che descrivono lo stesso brano reale, collegate per identità. */
function coppia(
  db: Database.Database,
  a: Record<string, unknown>,
  b: Record<string, unknown>,
  opts?: { aData?: string; bData?: string }
) {
  const ins = db.prepare(
    `INSERT INTO tracks (source, source_id, title, artist, genre, bpm, musical_key, rating,
                         track_color, path, data)
     VALUES (@source, @source_id, @title, @artist, @genre, @bpm, @musical_key, @rating,
             @track_color, @path, @data)`
  );
  const base = {
    title: 'Brano',
    artist: 'Artista',
    genre: null,
    bpm: null,
    musical_key: null,
    rating: null,
    track_color: null,
    path: 'C:/M/x.mp3'
  };
  const aId = Number(
    ins.run({ ...base, ...a, source_id: 'a1', data: opts?.aData ?? '{}' }).lastInsertRowid
  );
  const bId = Number(
    ins.run({ ...base, ...b, source_id: 'b1', data: opts?.bData ?? '{}' }).lastInsertRowid
  );
  // Collegamento canonico: è ciò che rende i due la stessa canzone.
  db.prepare(`UPDATE tracks SET canonical_id = ? WHERE id = ?`).run(aId, bId);
  return { aId, bId, canonicalId: aId };
}

const opts = (over?: Partial<SyncOptions>): SyncOptions => ({
  aSources: ['rekordbox'],
  bSources: ['traktor'],
  mode: 'symmetric',
  fields: CAMPI,
  ...over
});

describe('accoppiamento', () => {
  it('accoppia per identità canonica, non per riga', () => {
    const db = udm();
    coppia(db, { source: 'rekordbox', genre: 'House' }, { source: 'traktor', genre: null });
    const r = planLibrarySync(db, opts());
    expect(r.pairs).toHaveLength(1);
    expect(r.pairs[0].aSoftware).toBe('rekordbox');
    expect(r.pairs[0].bSoftware).toBe('traktor');
    db.close();
  });

  it('un brano presente in un solo lato non è un conflitto', () => {
    // È la condizione normale di due librerie che non contengono le stesse cose.
    const db = udm();
    db.prepare(
      `INSERT INTO tracks (source, source_id, title, path) VALUES ('rekordbox','solo','X','C:/x.mp3')`
    ).run();
    const r = planLibrarySync(db, opts());
    expect(r.pairs).toHaveLength(0);
    expect(r.unpaired).toBe(1);
    db.close();
  });

  it('non accoppia una riga con se stessa', () => {
    const db = udm();
    db.prepare(
      `INSERT INTO tracks (source, source_id, title, path) VALUES ('rekordbox','x','X','C:/x.mp3')`
    ).run();
    const r = planLibrarySync(db, { ...opts(), bSources: ['rekordbox'] });
    expect(r.pairs).toHaveLength(0);
    db.close();
  });
});

describe('primo allineamento', () => {
  it('riempie il lato vuoto senza chiedere niente', () => {
    const db = udm();
    const { aId, bId } = coppia(
      db,
      { source: 'rekordbox', genre: 'House', bpm: 128 },
      { source: 'traktor' }
    );
    const r = planLibrarySync(db, opts());
    expect(r.summary.conflicts).toBe(0);

    applySync(db, r, opts());
    const b = db.prepare(`SELECT genre, bpm FROM tracks WHERE id = ?`).get(bId) as {
      genre: string;
      bpm: number;
    };
    expect(b.genre).toBe('House');
    expect(b.bpm).toBe(128);
    // A non è stato toccato: non aveva niente da ricevere.
    const a = db.prepare(`SELECT genre FROM tracks WHERE id = ?`).get(aId) as { genre: string };
    expect(a.genre).toBe('House');
    db.close();
  });

  it('⚠ un secondo giro su una libreria ferma non fa niente', () => {
    /* La proprietà che rende utilizzabile la sincronizzazione automatica:
       senza, ogni giro riscriverebbe tutto e nessuno la lascerebbe accesa. */
    const db = udm();
    coppia(db, { source: 'rekordbox', genre: 'House' }, { source: 'traktor' });

    applySync(db, planLibrarySync(db, opts()), opts());
    const secondo = planLibrarySync(db, opts());

    expect(secondo.skipped).toBe(1);
    expect(secondo.pairs).toHaveLength(0);
    db.close();
  });
});

describe('conflitti', () => {
  it('due modifiche divergenti diventano un conflitto registrato, non una scelta arbitraria', () => {
    const db = udm();
    const { canonicalId } = coppia(
      db,
      { source: 'rekordbox', genre: 'House' },
      { source: 'traktor', genre: 'House' }
    );
    // Primo allineamento: concordano, niente da fare.
    applySync(db, planLibrarySync(db, opts()), opts());

    // Ora divergono: ognuno ha cambiato per conto proprio.
    db.prepare(`UPDATE tracks SET genre = 'Deep House' WHERE source = 'rekordbox'`).run();
    db.prepare(`UPDATE tracks SET genre = 'Techno' WHERE source = 'traktor'`).run();

    const r = planLibrarySync(db, opts());
    expect(r.summary.conflicts).toBe(1);

    applySync(db, r, opts());
    const aperti = db
      .prepare(`SELECT field, a_value, b_value FROM sync_conflicts WHERE canonical_id = ?`)
      .all(canonicalId) as { field: string; a_value: string; b_value: string }[];
    expect(aperti).toHaveLength(1);
    expect(aperti[0].field).toBe('genre');
    expect(aperti[0].a_value).toBe('Deep House');
    expect(aperti[0].b_value).toBe('Techno');

    // ⚠ Nessuno dei due è stato sovrascritto: decide l'utente.
    const valori = db
      .prepare(`SELECT source, genre FROM tracks ORDER BY source`)
      .all() as { source: string; genre: string }[];
    expect(valori.find((v) => v.source === 'rekordbox')?.genre).toBe('Deep House');
    expect(valori.find((v) => v.source === 'traktor')?.genre).toBe('Techno');
    db.close();
  });

  it('rivedere la stessa coppia non accumula conflitti duplicati', () => {
    const db = udm();
    const { canonicalId } = coppia(
      db,
      { source: 'rekordbox', genre: 'House' },
      { source: 'traktor', genre: 'House' }
    );
    applySync(db, planLibrarySync(db, opts()), opts());
    db.prepare(`UPDATE tracks SET genre = 'A' WHERE source = 'rekordbox'`).run();
    db.prepare(`UPDATE tracks SET genre = 'B' WHERE source = 'traktor'`).run();

    applySync(db, planLibrarySync(db, opts()), opts());
    applySync(db, planLibrarySync(db, opts()), opts());

    const n = (
      db
        .prepare(`SELECT COUNT(*) c FROM sync_conflicts WHERE canonical_id = ?`)
        .get(canonicalId) as { c: number }
    ).c;
    expect(n).toBe(1);
    db.close();
  });

  it('⚠ un campo in conflitto NON entra nella base del giro successivo', () => {
    /* Se ci entrasse, il giro dopo lo vedrebbe come «allineato» e smetterebbe
       di segnalarlo: il conflitto sparirebbe senza che nessuno l'abbia risolto. */
    const db = udm();
    const { canonicalId } = coppia(
      db,
      { source: 'rekordbox', genre: 'House', bpm: 128 },
      { source: 'traktor', genre: 'House', bpm: 128 }
    );
    applySync(db, planLibrarySync(db, opts()), opts());
    db.prepare(`UPDATE tracks SET genre = 'A' WHERE source = 'rekordbox'`).run();
    db.prepare(`UPDATE tracks SET genre = 'B' WHERE source = 'traktor'`).run();
    applySync(db, planLibrarySync(db, opts()), opts());

    const stato = db
      .prepare(`SELECT last_synced_digest FROM sync_state WHERE canonical_id = ? LIMIT 1`)
      .get(canonicalId) as { last_synced_digest: string };
    const base = JSON.parse(stato.last_synced_digest) as Record<string, unknown>;
    expect(base.genre).toBeUndefined();
    // Il BPM invece è allineato e ci entra.
    expect(base.bpm).toBe(128);
    db.close();
  });

  it('l’esito registrato dice se sono rimasti conflitti', () => {
    const db = udm();
    const { canonicalId } = coppia(
      db,
      { source: 'rekordbox', genre: 'House' },
      { source: 'traktor', genre: 'House' }
    );
    applySync(db, planLibrarySync(db, opts()), opts());
    let esito = db
      .prepare(`SELECT outcome FROM sync_state WHERE canonical_id = ? LIMIT 1`)
      .get(canonicalId) as { outcome: string };
    expect(esito.outcome).toBe('ok');

    db.prepare(`UPDATE tracks SET genre = 'A' WHERE source = 'rekordbox'`).run();
    db.prepare(`UPDATE tracks SET genre = 'B' WHERE source = 'traktor'`).run();
    applySync(db, planLibrarySync(db, opts()), opts());
    esito = db
      .prepare(`SELECT outcome FROM sync_state WHERE canonical_id = ? LIMIT 1`)
      .get(canonicalId) as { outcome: string };
    expect(esito.outcome).toBe('conflict');
    db.close();
  });
});

describe('master → slave', () => {
  it('il master vince e niente risale', () => {
    const db = udm();
    const { aId, bId } = coppia(
      db,
      { source: 'rekordbox', genre: 'House', bpm: 128 },
      { source: 'traktor', genre: 'Techno', bpm: 130 }
    );
    const o = opts({ mode: 'masterSlave' });
    const r = planLibrarySync(db, o);
    expect(r.summary.conflicts).toBe(0);

    applySync(db, r, o);
    const a = db.prepare(`SELECT genre, bpm FROM tracks WHERE id = ?`).get(aId) as {
      genre: string;
      bpm: number;
    };
    const b = db.prepare(`SELECT genre, bpm FROM tracks WHERE id = ?`).get(bId) as {
      genre: string;
      bpm: number;
    };
    // ⚠ Il master non riceve: è il senso di designarlo.
    expect(a.genre).toBe('House');
    expect(a.bpm).toBe(128);
    expect(b.genre).toBe('House');
    expect(b.bpm).toBe(128);
    db.close();
  });
});

describe('la prova a vuoto non scrive', () => {
  it('calcolare il piano lascia l’archivio com’era', () => {
    const db = udm();
    const { bId } = coppia(db, { source: 'rekordbox', genre: 'House' }, { source: 'traktor' });
    planLibrarySync(db, opts());
    planLibrarySync(db, opts());
    const b = db.prepare(`SELECT genre FROM tracks WHERE id = ?`).get(bId) as { genre: null };
    expect(b.genre).toBeNull();
    const stati = (db.prepare(`SELECT COUNT(*) c FROM sync_state`).get() as { c: number }).c;
    expect(stati).toBe(0);
    db.close();
  });
});

describe('campi sincronizzati', () => {
  it('il predefinito non tocca i campi testuali', () => {
    /* Chi ha ripulito i generi in un software raramente vuole che quelli di un
       altro glieli sovrascrivano: il resto si accende sapendo cosa si accende. */
    const db = udm();
    const { bId } = coppia(
      db,
      { source: 'rekordbox', genre: 'House', bpm: 128 },
      { source: 'traktor' }
    );
    const o: SyncOptions = { aSources: ['rekordbox'], bSources: ['traktor'], mode: 'symmetric' };
    applySync(db, planLibrarySync(db, o), o);
    const b = db.prepare(`SELECT genre, bpm FROM tracks WHERE id = ?`).get(bId) as {
      genre: string | null;
      bpm: number;
    };
    expect(b.bpm).toBe(128);
    expect(b.genre).toBeNull();
    db.close();
  });
});
