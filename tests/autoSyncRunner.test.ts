import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { migrate } from '../src/core/schema';
import { runLibrarySync, type LiveRow, type RunnerDeps } from '../src/main/autoSyncRunner';
import type { GuardedSoftware } from '../src/core/djVersions';

/**
 * Il giro completo, con rilettura e scrittura simulate. Le librerie dei
 * programmi sono mappe in memoria: rileggere copia la mappa nell'archivio,
 * scrivere copia l'archivio nella mappa. Così si vede l'effetto che conta —
 * che cosa trova l'utente nei programmi DOPO, anche al giro successivo.
 */

type Lib = Map<string, { title: string; genre: string | null }>;
const SRC: Partial<Record<GuardedSoftware, string>> = {
  rekordbox: 'masterdb',
  traktor: 'traktor',
  virtualdj: 'virtualdj',
  engine: 'engine'
};

function banco(libs: Partial<Record<GuardedSoftware, Lib>>, readOnly: GuardedSoftware[] = []) {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = OFF');
  migrate(db);
  const scritture: { software: GuardedSoftware; rows: LiveRow[] }[] = [];

  const deps: RunnerDeps = {
    db,
    reimport: async (software) => {
      const lib = libs[software];
      if (!lib) return { ok: false, message: 'assente' };
      for (const [id, t] of lib) {
        db.prepare(
          `INSERT INTO tracks (source, source_id, title, genre, path, data)
           VALUES (?, ?, ?, ?, ?, '{}')
           ON CONFLICT(source, source_id) DO UPDATE SET title = excluded.title, genre = excluded.genre`
        ).run(SRC[software], id, t.title, t.genre, `C:/M/${id}.mp3`);
      }
      // Identità canonica: stesso percorso, stesso brano.
      db.exec(`UPDATE tracks SET canonical_id = (SELECT MIN(id) FROM tracks t2 WHERE t2.path = tracks.path)
               WHERE id <> (SELECT MIN(id) FROM tracks t2 WHERE t2.path = tracks.path)`);
      return { ok: true };
    },
    canWrite: async (software) => (readOnly.includes(software) ? 'sola lettura' : null),
    write: async (software, rows) => {
      scritture.push({ software, rows });
      const lib = libs[software]!;
      for (const r of rows) {
        const t = lib.get(r.sourceId)!;
        if ('title' in r.values) t.title = r.values.title ?? '';
        if ('genre' in r.values) t.genre = r.values.genre ?? null;
      }
      return { written: rows.length, missing: 0 };
    }
  };
  return { db, deps, scritture };
}

const lib = (genre: string | null, title = 'Brano'): Lib => new Map([['x', { title, genre }]]);

describe('giro completo — master → slave', () => {
  it('le modifiche del master arrivano negli slave', async () => {
    const libs = { rekordbox: lib(null), traktor: lib(null), engine: lib(null) };
    const b = banco(libs);
    await runLibrarySync(b.deps, { mode: 'masterSlave', fields: ['genre'] }, 'rekordbox', ['traktor', 'engine']);
    // primo giro: base vuota. L'utente cambia il genere nel master.
    libs.rekordbox.get('x')!.genre = 'Techno';
    const r = await runLibrarySync(b.deps, { mode: 'masterSlave', fields: ['genre'] }, 'rekordbox', ['traktor', 'engine']);
    expect(libs.traktor.get('x')!.genre).toBe('Techno');
    expect(libs.engine.get('x')!.genre).toBe('Techno');
    expect(r.written.map((w) => w.software).sort()).toEqual(['engine', 'traktor']);
  });

  it('⚠ il master non riceve mai, anche se uno slave è diverso', async () => {
    const libs = { rekordbox: lib('House'), traktor: lib('Garage') };
    const b = banco(libs);
    await runLibrarySync(b.deps, { mode: 'masterSlave', fields: ['genre'] }, 'rekordbox', ['traktor']);
    expect(libs.rekordbox.get('x')!.genre).toBe('House');
    expect(libs.traktor.get('x')!.genre).toBe('House');
    expect(b.scritture.every((s) => s.software !== 'rekordbox')).toBe(true);
  });
});

describe('giro completo — tutti alla pari', () => {
  it('una modifica in uno slave raggiunge tutti gli altri nello stesso giro', async () => {
    const libs = { traktor: lib('House'), virtualdj: lib('House'), engine: lib('House') };
    const b = banco(libs);
    const cfg = { mode: 'symmetric' as const, fields: ['genre'] };
    await runLibrarySync(b.deps, cfg, 'traktor', ['virtualdj', 'engine']); // base
    libs.virtualdj.get('x')!.genre = 'Disco';
    // si chiude Traktor, ma la modifica era in VirtualDJ: rilettura + due passate
    await runLibrarySync(b.deps, cfg, 'traktor', ['virtualdj', 'engine']);
    expect(libs.traktor.get('x')!.genre).toBe('Disco');
    expect(libs.engine.get('x')!.genre).toBe('Disco');
  });

  it('⚠ chi non si può scrivere non riceve, e la modifica non rimbalza indietro', async () => {
    /* Rekordbox è di sola lettura. Se ricevesse nell'archivio senza poter
       ricevere nella libreria, al giro dopo verrebbe riletto col valore vecchio
       e lo rimanderebbe a tutti, annullando la modifica dell'utente. */
    const libs = { rekordbox: lib('House'), traktor: lib('House') };
    const b = banco(libs, ['rekordbox']);
    const cfg = { mode: 'symmetric' as const, fields: ['genre'] };
    await runLibrarySync(b.deps, cfg, 'traktor', ['rekordbox']);
    libs.traktor.get('x')!.genre = 'Disco';
    const r = await runLibrarySync(b.deps, cfg, 'traktor', ['rekordbox']);
    expect(r.excluded).toEqual([{ software: 'rekordbox', reason: 'sola lettura' }]);
    await runLibrarySync(b.deps, cfg, 'traktor', ['rekordbox']);
    expect(libs.traktor.get('x')!.genre).toBe('Disco');
    expect(b.scritture.every((s) => s.software !== 'rekordbox')).toBe(true);
  });

  it('una libreria di sola lettura che si chiude fa da origine a senso unico', async () => {
    const libs = { rekordbox: lib('House'), traktor: lib('House') };
    const b = banco(libs, ['rekordbox']);
    const cfg = { mode: 'symmetric' as const, fields: ['genre'] };
    await runLibrarySync(b.deps, cfg, 'rekordbox', ['traktor']);
    libs.rekordbox.get('x')!.genre = 'Techno';
    libs.traktor.get('x')!.genre = 'Garage'; // cambiato anche qui: conflitto possibile
    await runLibrarySync(b.deps, cfg, 'rekordbox', ['traktor']);
    expect(libs.rekordbox.get('x')!.genre).toBe('Techno'); // mai scritto
    expect(b.scritture.every((s) => s.software !== 'rekordbox')).toBe(true);
  });
});

describe('giro completo — errori', () => {
  it('se l’origine non si rilegge, il giro non parte e l’errore risale', async () => {
    const b = banco({ traktor: lib('House') });
    await expect(
      runLibrarySync(b.deps, { mode: 'symmetric', fields: ['genre'] }, 'virtualdj', ['traktor'])
    ).rejects.toThrow(/Rilettura di virtualdj/);
  });

  it('dice quali campi scelti non arrivano nei programmi', async () => {
    const b = banco({ traktor: lib('House'), engine: lib('House') });
    const r = await runLibrarySync(b.deps, { mode: 'symmetric', fields: ['genre', 'rating'] }, 'traktor', ['engine']);
    expect(r.notPropagated).toEqual(['rating']);
  });
});
