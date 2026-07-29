import type BetterSqlite3 from 'better-sqlite3';
import { camelotToString, compatibleKeys, parseCamelot } from '@core/harmony';

/**
 * Set Builder (funzione nata in-app, modalità Esperto): da un brano di
 * partenza costruisce una SCALETTA SUGGERITA di N brani, greedy:
 *  - ogni passo sceglie tra i brani con key compatibile (regola Camelot)
 *    e BPM entro ±6% dal target del passo;
 *  - il target BPM segue la curva scelta (up ~+1.5%/passo, flat, down);
 *  - nessun brano ripetuto; a parità, meglio key identica e BPM più vicino.
 * READ-ONLY sulla libreria: l'output è una proposta; l'export è il solito
 * XML con playlist da importare a mano. Onestà: è un suggerimento
 * matematico, non un DJ — la UI lo dice.
 */

export type BpmCurve = 'up' | 'flat' | 'down';

export interface SetTrack {
  id: number;
  title: string | null;
  artist: string | null;
  bpm: number;
  camelot: string;
  genre: string | null;
  duration_s: number | null;
}

export interface BuildResult {
  tracks: SetTrack[];
  requested: number;
  /** true se la scaletta si è fermata prima per mancanza di candidati */
  exhausted: boolean;
  totalDurationS: number;
}

const BPM_WINDOW = 0.06; // ±6%, coerente con la soglia del Set Planner
const CURVE_STEP: Record<BpmCurve, number> = { up: 1.015, flat: 1.0, down: 0.985 };

export function buildSet(
  db: BetterSqlite3.Database,
  startTrackId: number,
  length: number,
  curve: BpmCurve
): BuildResult {
  const start = db
    .prepare(
      `SELECT id, title, artist, bpm, camelot, genre, duration_s FROM tracks WHERE id = ?`
    )
    .get(startTrackId) as SetTrack | undefined;
  if (!start) throw new Error('Brano di partenza non trovato.');
  if (!start.camelot || !start.bpm || start.bpm <= 0) {
    throw new Error('Il brano di partenza deve avere key e BPM (analizzalo o completali prima).');
  }

  const n = Math.min(Math.max(length, 2), 60);
  const picked: SetTrack[] = [start];
  const used = new Set<number>([start.id]);
  let currentKey = parseCamelot(start.camelot)!;
  let targetBpm = start.bpm;
  let exhausted = false;

  const candidateStmt = db.prepare(
    `SELECT id, title, artist, bpm, camelot, genre, duration_s FROM tracks
     WHERE camelot IN (SELECT value FROM json_each(?))
       AND bpm BETWEEN ? AND ?
       AND needs_review = 0
       AND id NOT IN (SELECT value FROM json_each(?))
     LIMIT 400`
  );

  while (picked.length < n) {
    targetBpm = targetBpm * CURVE_STEP[curve];
    const keys = compatibleKeys(currentKey).map(camelotToString);
    const rows = candidateStmt.all(
      JSON.stringify(keys),
      targetBpm * (1 - BPM_WINDOW),
      targetBpm * (1 + BPM_WINDOW),
      JSON.stringify([...used])
    ) as SetTrack[];
    if (rows.length === 0) {
      exhausted = true;
      break;
    }
    const currentKeyStr = camelotToString(currentKey);
    const prev = picked[picked.length - 1];
    let best: SetTrack | null = null;
    let bestScore = -Infinity;
    for (const c of rows) {
      // key identica premiata, poi vicinanza al BPM target, piccolo bonus
      // per lo stesso genere (continuità di suono), malus stesso artista
      // di fila (varietà).
      let s = c.camelot === currentKeyStr ? 2 : 1;
      s += 1 - Math.abs(c.bpm - targetBpm) / (targetBpm * BPM_WINDOW);
      if (c.genre && prev.genre && c.genre === prev.genre) s += 0.3;
      if (c.artist && prev.artist && c.artist === prev.artist) s -= 0.5;
      if (s > bestScore) {
        bestScore = s;
        best = c;
      }
    }
    const chosen = best!;
    picked.push(chosen);
    used.add(chosen.id);
    currentKey = parseCamelot(chosen.camelot)!;
    targetBpm = chosen.bpm; // il target riparte dal BPM reale scelto
  }

  return {
    tracks: picked,
    requested: n,
    exhausted,
    totalDurationS: picked.reduce((s, t) => s + (t.duration_s ?? 0), 0)
  };
}
