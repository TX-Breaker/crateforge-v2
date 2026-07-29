import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import Database from 'better-sqlite3';
import { migrate } from '@core/schema';
import { importForeignLibrary } from '@core/foreignImport';
import { writeTraktorNml } from '@adapters/traktor/nmlWriter';
import { writeVirtualDjXml } from '@adapters/virtualdj/vdjWriter';
import { readTraktorNml } from '@adapters/traktor/nmlReader';
import { readVirtualDjXml } from '@adapters/virtualdj/vdjReader';

/**
 * MATRICE DI CONVERSIONE: nessun cue deve sparire in silenzio.
 *
 * Il rischio vero di un convertitore non è il crash — è la perdita muta: il
 * file viene scritto, il conteggio dei brani torna, e mesi dopo il DJ scopre
 * che i punti di attacco non ci sono più. Qui costruiamo una libreria con
 * TUTTI i tipi di cue del pivot (hot su pad, hot senza pad, memory, loop) e
 * verifichiamo su ogni rotta scrivibile che ciò che non sopravvive venga
 * almeno DICHIARATO nei warning.
 */

let tmp: string;
let db: InstanceType<typeof Database>;

/** Libreria di partenza: un brano con un cue di ogni specie. */
function seed(target: InstanceType<typeof Database>): number {
  const info = target
    .prepare(
      `INSERT INTO tracks (source, source_id, title, artist, path, bpm, musical_key, duration_s)
       VALUES ('xml', 'T1', 'Prova', 'Artista', ?, 128, 'Am', 300)`
    )
    .run(process.platform === 'win32' ? 'C:\\Musica\\prova.mp3' : '/Musica/prova.mp3');
  const trackId = Number(info.lastInsertRowid);
  const cue = target.prepare(
    `INSERT INTO cues (track_id, cue_type, cue_index, position_ms, length_ms, color, label)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  cue.run(trackId, 'hot', 0, 1000, null, '#FF0000', 'Attacco');
  cue.run(trackId, 'hot', 1, 2000, null, '#00FF00', 'Drop');
  cue.run(trackId, 'memory', null, 3000, null, '#0000FF', 'Break');
  cue.run(trackId, 'loop', 2, 4000, 2000, '#FFFF00', 'Loop 4b');
  return trackId;
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'cf-matrix-'));
  db = new Database(':memory:');
  migrate(db);
  seed(db);
});
afterEach(() => {
  db.close();
  rmSync(tmp, { recursive: true, force: true });
});

/** Conta i cue per tipo in un UDM. */
function cueCounts(target: InstanceType<typeof Database>): Record<string, number> {
  const rows = target
    .prepare(`SELECT cue_type, COUNT(*) n FROM cues GROUP BY cue_type`)
    .all() as { cue_type: string; n: number }[];
  return Object.fromEntries(rows.map((r) => [r.cue_type, r.n]));
}

describe('matrice di conversione — nessuna perdita muta', () => {
  it('VirtualDJ: ogni cue del pivot finisce nel file esportato', () => {
    const out = join(tmp, 'vdj.xml');
    const res = writeVirtualDjXml(db, out);
    const back = new Database(':memory:');
    migrate(back);
    importForeignLibrary(back, readVirtualDjXml(out));
    const counts = cueCounts(back);
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    back.close();

    // 4 cue in ingresso → 4 marker nel file: nessuno perso per strada.
    expect(total).toBe(4);
    // La memory sopravvive come marker (prima spariva del tutto).
    expect(counts.memory ?? 0).toBeGreaterThanOrEqual(1);
    // E la sua trasformazione è dichiarata, non silenziosa.
    expect(res.warnings.some((w) => w.toLowerCase().includes('memory'))).toBe(true);
  });

  it('Traktor: hot, memory e loop sopravvivono al round-trip', () => {
    const out = join(tmp, 'lib.nml');
    writeTraktorNml(db, out);
    const back = new Database(':memory:');
    migrate(back);
    importForeignLibrary(back, readTraktorNml(out));
    const counts = cueCounts(back);
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    back.close();

    expect(total).toBeGreaterThanOrEqual(4);
    expect(counts.hot ?? 0).toBeGreaterThanOrEqual(2); // i due hot su pad
    expect(counts.loop ?? 0).toBeGreaterThanOrEqual(1); // il loop con lunghezza
  });

  it('le posizioni dei cue restano fedeli al millisecondo (VirtualDJ)', () => {
    const out = join(tmp, 'vdj.xml');
    writeVirtualDjXml(db, out);
    const back = new Database(':memory:');
    migrate(back);
    importForeignLibrary(back, readVirtualDjXml(out));
    const positions = (
      back.prepare('SELECT position_ms FROM cues ORDER BY position_ms').all() as {
        position_ms: number;
      }[]
    ).map((r) => Math.round(r.position_ms));
    back.close();
    expect(positions).toEqual([1000, 2000, 3000, 4000]);
  });

  it('un hot cue senza pad non viene buttato via in silenzio', () => {
    // Caso reale: arriva da VirtualDJ un Poi senza attributo Num, oppure da
    // Engine un cue oltre gli 8 pad. Prima cadeva fuori dalla catena if/else.
    db.prepare(`DELETE FROM cues`).run();
    const trackId = (db.prepare('SELECT id FROM tracks').get() as { id: number }).id;
    db.prepare(
      `INSERT INTO cues (track_id, cue_type, cue_index, position_ms, length_ms, color, label)
       VALUES (?, 'hot', NULL, 5000, NULL, NULL, 'Senza pad')`
    ).run(trackId);

    const out = join(tmp, 'vdj.xml');
    const res = writeVirtualDjXml(db, out);
    const back = new Database(':memory:');
    migrate(back);
    importForeignLibrary(back, readVirtualDjXml(out));
    const total = (back.prepare('SELECT COUNT(*) c FROM cues').get() as { c: number }).c;
    back.close();

    expect(total).toBe(1); // la posizione è conservata
    expect(res.warnings.some((w) => w.includes('pad'))).toBe(true); // ed è dichiarato
  });

  it('il colore attraversa la conversione verso VirtualDJ', () => {
    const out = join(tmp, 'vdj.xml');
    writeVirtualDjXml(db, out);
    const back = new Database(':memory:');
    migrate(back);
    importForeignLibrary(back, readVirtualDjXml(out));
    const colored = (
      back.prepare(`SELECT COUNT(*) c FROM cues WHERE color IS NOT NULL`).get() as { c: number }
    ).c;
    back.close();
    // Prima il writer non emetteva mai Color: tutti i colori si perdevano.
    expect(colored).toBeGreaterThanOrEqual(4);
  });
});
