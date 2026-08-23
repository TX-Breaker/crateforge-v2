import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { existsSync } from 'fs';
import { readSerato4Library } from '../src/adapters/serato4/reader';
import { serato4DatabasePath, serato4Paths } from '../src/adapters/serato4';

/**
 * Validazione del lettore Serato 4 contro la libreria REALE installata su
 * questa macchina, aperta in SOLA LETTURA.
 *
 * ⚠ Nessun titolo, artista o percorso della libreria personale finisce negli
 * asserti o nell'output: si verificano forme, conteggi e invarianti. Un test
 * che stampasse la libreria dell'utente sarebbe un test che la copia dentro un
 * log di CI.
 *
 * Si auto-salta se Serato 4 non è installato: la suite deve girare anche su una
 * macchina pulita.
 */

const master = serato4DatabasePath();
const disponibile = master !== null && existsSync(master);
const d = disponibile ? describe : describe.skip;

d('Serato 4 — libreria reale (sola lettura)', () => {
  it('trova il database principale e riconosce i satelliti', () => {
    const p = serato4Paths(master as string);
    expect(p.master.endsWith('master.sqlite')).toBe(true);
    // I satelliti possono legittimamente mancare: si verifica il tipo, non la
    // presenza.
    for (const sat of [p.root, p.location]) {
      expect(sat === null || typeof sat === 'string').toBe(true);
    }
  });

  it('il database ha la forma a grafo descritta dalla specifica', () => {
    const db = new Database(master as string, { readonly: true, fileMustExist: true });
    try {
      const tabelle = new Set(
        (db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as {
          name: string;
        }[]).map((r) => r.name)
      );
      // Le cinque portanti della catena container → space_asset → asset.
      for (const t of ['asset', 'container', 'container_asset', 'space', 'space_asset']) {
        expect(tabelle.has(t), `manca la tabella ${t}`).toBe(true);
      }
      // ⚠ NON esiste una tabella di tracce: è il punto che distingue Serato 4.
      expect(tabelle.has('Track')).toBe(false);
      expect(tabelle.has('tracks')).toBe(false);
    } finally {
      db.close();
    }
  });

  it('container_asset punta a space_asset, non direttamente ad asset', () => {
    // È l'invariante che, se ignorata, produce crate vuoti in scrittura.
    const db = new Database(master as string, { readonly: true, fileMustExist: true });
    try {
      const cols = new Set(
        (db.prepare(`PRAGMA table_info(container_asset)`).all() as { name: string }[]).map(
          (r) => r.name
        )
      );
      expect(cols.has('space_asset_id')).toBe(true);
      expect(cols.has('location_container_id')).toBe(true);
    } finally {
      db.close();
    }
  });

  it('legge la libreria senza lanciare e con identità stabile per ogni brano', () => {
    const lib = readSerato4Library(master as string);

    expect(lib.source).toBe('serato');
    expect(lib.formatNamespace).toBe('serato4');
    expect(Array.isArray(lib.tracks)).toBe(true);

    const ids = new Set<string>();
    for (const t of lib.tracks) {
      expect(t.sourceId, 'ogni brano deve avere un identificatore').toBeTruthy();
      expect(ids.has(t.sourceId), 'identificatori duplicati').toBe(false);
      ids.add(t.sourceId);
      // L'identità nativa va conservata, altrimenti un export ricrea invece di
      // aggiornare.
      expect(t.formatData).toBeDefined();
      expect(typeof (t.formatData as Record<string, unknown>).assetId).toBe('number');
    }

    // Conteggi, non contenuti.
    console.log(
      `[serato4] ${lib.tracks.length} brani, ${lib.playlists.length} contenitori, ` +
        `${lib.emptyContainers} vuoti saltati`
    );
  });

  it('dichiara esplicitamente che i cue non stanno in questo database', () => {
    const lib = readSerato4Library(master as string);
    // Un import "riuscito" con zero cue non deve sembrare una perdita di dati.
    expect(lib.tracks.every((t) => t.cues.length === 0)).toBe(true);
    expect(lib.warnings.some((w) => w.toLowerCase().includes('cue'))).toBe(true);
  });

  it('le playlist riferiscono solo brani presenti nella libreria letta', () => {
    const lib = readSerato4Library(master as string);
    const noti = new Set(lib.tracks.map((t) => t.sourceId));
    for (const p of lib.playlists) {
      for (const id of p.trackSourceIds) {
        expect(noti.has(id), 'una playlist riferisce un brano che non è stato letto').toBe(true);
      }
    }
  });

  it('non modifica il database: la connessione è di sola lettura', () => {
    const db = new Database(master as string, { readonly: true, fileMustExist: true });
    try {
      expect(() => db.prepare(`CREATE TABLE cf_prova (x INTEGER)`).run()).toThrow();
    } finally {
      db.close();
    }
  });
});
