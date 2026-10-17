import type BetterSqlite3 from 'better-sqlite3';
import type { LiveValues } from '../livePatch';

/**
 * Aggiorna sul posto la tabella `Track` di una libreria Engine DJ (`m.db`).
 *
 * La chiave è `Track.id`, lo stesso valore con cui il lettore importa il brano
 * (`sourceId`). Si scrivono solo le colonne che esistono in QUESTA versione
 * dello schema: Engine le ha cambiate fra una versione e l'altra, e una colonna
 * data per scontata farebbe fallire l'intero giro.
 *
 * Tempo: si aggiornano insieme `bpmAnalyzed` (quello con cui Engine suona) e
 * `bpm` (il dichiarato, intero). Tonalità: `key` è un intero ordinato Camelot,
 * non cromatico — vedi il lettore.
 *
 * Tutto in una transazione: o si aggiornano tutti i brani, o nessuno.
 */
export function patchEngineTracks(
  db: BetterSqlite3.Database,
  updates: Map<string, LiveValues>
): { patched: number; missing: string[] } {
  const cols = new Set(
    (db.prepare(`PRAGMA table_info(Track)`).all() as { name: string }[]).map((c) => c.name)
  );
  if (!cols.has('id')) throw new Error('Libreria Engine non riconosciuta: manca Track.id.');
  const exists = db.prepare(`SELECT 1 FROM Track WHERE id = ?`);

  let patched = 0;
  const missing: string[] = [];
  const run = db.transaction(() => {
    for (const [id, v] of updates) {
      if (!exists.get(Number(id))) {
        missing.push(id);
        continue;
      }
      const set: [string, unknown][] = [];
      const put = (col: string, val: unknown) => {
        if (cols.has(col)) set.push([col, val]);
      };
      if ('title' in v) put('title', v.title ?? null);
      if ('artist' in v) put('artist', v.artist ?? null);
      if ('album' in v) put('album', v.album ?? null);
      if ('genre' in v) put('genre', v.genre ?? null);
      if ('year' in v) put('year', v.year ?? null);
      if ('bpm' in v && v.bpm != null && v.bpm > 0) {
        put('bpmAnalyzed', v.bpm);
        put('bpm', Math.round(v.bpm));
      }
      if ('camelot' in v) {
        const k = engineKeyOf(v.camelot ?? null);
        if (k !== null) put('key', k);
      }
      if (set.length === 0) continue;
      db.prepare(`UPDATE Track SET ${set.map(([c]) => `${c} = ?`).join(', ')} WHERE id = ?`).run(
        ...set.map(([, val]) => val),
        Number(id)
      );
      patched++;
    }
  });
  run();
  return { patched, missing };
}

/** Camelot («8A») → intero Engine: (numero−1)·2, +1 per il lato A (minore). */
export function engineKeyOf(camelot: string | null): number | null {
  const m = camelot ? /^(1[0-2]|[1-9])([AB])$/.exec(camelot) : null;
  if (!m) return null;
  return (Number(m[1]) - 1) * 2 + (m[2] === 'A' ? 1 : 0);
}
