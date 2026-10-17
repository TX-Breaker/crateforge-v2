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
  /* Si legge la riga per confrontare: Engine ha un trigger che aggiorna
     `lastEditTime` a ogni UPDATE di queste colonne, ANCHE con lo stesso valore.
     Scrivere solo ciò che cambia evita di far sembrare modificati brani che
     nessuno ha toccato. */
  const current = db.prepare(`SELECT * FROM Track WHERE id = ?`);

  let patched = 0;
  const missing: string[] = [];
  const run = db.transaction(() => {
    for (const [id, v] of updates) {
      const row = current.get(Number(id)) as Record<string, unknown> | undefined;
      if (!row) {
        missing.push(id);
        continue;
      }
      const set: [string, unknown][] = [];
      const put = (col: string, val: unknown) => {
        if (!cols.has(col)) return;
        const cur = row[col];
        const same =
          typeof val === 'number' && typeof cur === 'number' ? Math.abs(val - cur) < 0.001 : (cur ?? null) === (val ?? null);
        if (!same) set.push([col, val]);
      };
      if ('title' in v) put('title', v.title ?? null);
      if ('artist' in v) put('artist', v.artist ?? null);
      if ('album' in v) put('album', v.album ?? null);
      if ('genre' in v) put('genre', v.genre ?? null);
      if ('year' in v) put('year', v.year ?? null);
      if ('bpm' in v && v.bpm != null && v.bpm > 0) {
        /* ⚠ Engine ha DUE tempi: `bpmAnalyzed` (quello che legge l'archivio) e
           `bpm`, intero, dichiarato dal tag o dall'utente. Il dichiarato si
           tocca solo se il tempo cambia davvero: riscriverlo ogni volta con
           l'analizzato arrotondato cancellava ciò che l'utente aveva scritto. */
        const curAnalyzed = typeof row.bpmAnalyzed === 'number' ? row.bpmAnalyzed : null;
        if (curAnalyzed === null || Math.abs(curAnalyzed - v.bpm) >= 0.001) {
          put('bpmAnalyzed', v.bpm);
          put('bpm', Math.round(v.bpm));
        }
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
