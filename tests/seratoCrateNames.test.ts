import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { migrate } from '../src/core/schema';
import {
  SUBCRATE_SEPARATOR,
  crateNameFor,
  loadPlaylistTree,
  playlistPath
} from '../src/adapters/serato/crateNames';

function udmConAlbero() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = OFF');
  migrate(db);
  db.pragma('foreign_keys = ON');
  const ins = db.prepare(
    `INSERT INTO playlists (id, source, source_id, name, parent_id, is_folder, sort_order)
     VALUES (?, 'serato', ?, ?, ?, ?, 0)`
  );
  //  Genere/                 (cartella)
  //    House/                (cartella)
  //      Deep                (crate)
  //    Techno                (crate)
  //  Sconti 50%              (crate con un % nel nome)
  ins.run(1, 'f1', 'Genere', null, 1);
  ins.run(2, 'f2', 'House', 1, 1);
  ins.run(3, 'p3', 'Deep', 2, 0);
  ins.run(4, 'p4', 'Techno', 1, 0);
  ins.run(5, 'p5', 'Sconti 50%', null, 0);
  return db;
}

describe('nomi dei crate Serato ≤3', () => {
  it('scrive la gerarchia nel nome con %%, perché Subcrates è piatta', () => {
    const db = udmConAlbero();
    const tree = loadPlaylistTree(db);
    expect(crateNameFor(tree, 3)).toBe(`Genere${SUBCRATE_SEPARATOR}House${SUBCRATE_SEPARATOR}Deep`);
    expect(crateNameFor(tree, 4)).toBe(`Genere${SUBCRATE_SEPARATOR}Techno`);
    db.close();
  });

  it('una playlist in radice resta il proprio nome', () => {
    const db = udmConAlbero();
    expect(crateNameFor(loadPlaylistTree(db), 5)).toBe('Sconti 50_');
    db.close();
  });

  it('sostituisce i % dei nomi originali, per non inventare un annidamento', () => {
    // «Sconti 50%» + «House» non deve diventare «Sconti 50%%House», che Serato
    // leggerebbe come "House dentro Sconti 50".
    const db = udmConAlbero();
    const nome = crateNameFor(loadPlaylistTree(db), 5);
    expect(nome).not.toContain('%');
    db.close();
  });

  it('chiude il round-trip con il decodificatore del lettore', () => {
    // Il lettore fa `name.replace("%%", " / ")`: partendo dall'albero e
    // tornando indietro si deve riottenere la stessa gerarchia.
    const db = udmConAlbero();
    const scritto = crateNameFor(loadPlaylistTree(db), 3);
    expect(scritto.split(SUBCRATE_SEPARATOR)).toEqual(['Genere', 'House', 'Deep']);
    db.close();
  });

  it('non entra in ricorsione infinita su un albero ciclico', () => {
    // Non dovrebbe accadere (c'è una foreign key), ma un database riparato a
    // mano può contenerne, e un export che si pianta non dice perché.
    const db = udmConAlbero();
    db.prepare(`UPDATE playlists SET parent_id = 3 WHERE id = 1`).run();
    const tree = loadPlaylistTree(db);
    const parti = playlistPath(tree, 3);
    expect(parti.length).toBeLessThanOrEqual(tree.size);
    db.close();
  });

  it('salta i segmenti vuoti invece di produrre separatori doppi', () => {
    const db = udmConAlbero();
    db.prepare(`UPDATE playlists SET name = '   ' WHERE id = 2`).run();
    expect(crateNameFor(loadPlaylistTree(db), 3)).toBe(`Genere${SUBCRATE_SEPARATOR}Deep`);
    db.close();
  });
});
