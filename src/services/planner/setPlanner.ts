import type BetterSqlite3 from 'better-sqlite3';
import {
  camelotToString,
  checkTransition,
  compatibleKeys,
  parseCamelot,
  TransitionCheck
} from '@core/harmony';

/**
 * Set Planner (§6 Fase 3.2): analisi READ-ONLY di una playlist.
 * Segnala transizioni armoniche problematiche (Camelot) e salti di BPM,
 * suggerendo tracce-ponte dalla libreria. Onestà tecnica: l'energia vera del
 * brano non è nel database — usiamo BPM come proxy e lo dichiariamo in UI.
 */

export interface PlannerTrack {
  id: number;
  title: string | null;
  artist: string | null;
  bpm: number | null;
  camelot: string | null;
  position: number;
}

export interface PlannerTransition extends TransitionCheck {
  from: PlannerTrack;
  to: PlannerTrack;
  bridges: PlannerTrack[]; // solo per transizioni problematiche
}

export function listPlaylists(
  db: BetterSqlite3.Database
): { id: number; name: string; trackCount: number }[] {
  return db
    .prepare(
      `SELECT p.id, p.name, COUNT(pt.track_id) AS trackCount
       FROM playlists p
       JOIN playlist_tracks pt ON pt.playlist_id = p.id
       WHERE p.is_folder = 0
       GROUP BY p.id
       HAVING trackCount >= 2
       ORDER BY p.name`
    )
    .all() as { id: number; name: string; trackCount: number }[];
}

function playlistTracks(db: BetterSqlite3.Database, playlistId: number): PlannerTrack[] {
  return db
    .prepare(
      `SELECT t.id, t.title, t.artist, t.bpm, t.camelot, pt.position
       FROM playlist_tracks pt
       JOIN tracks t ON t.id = pt.track_id
       WHERE pt.playlist_id = ?
       ORDER BY pt.position`
    )
    .all(playlistId) as PlannerTrack[];
}

/**
 * Tracce-ponte: compatibili in key con ENTRAMBI i lati della transizione e con
 * BPM intermedio (con margine del 4%). Massimo `limit` suggerimenti.
 */
export function suggestBridges(
  db: BetterSqlite3.Database,
  from: PlannerTrack,
  to: PlannerTrack,
  limit = 3
): PlannerTrack[] {
  const a = parseCamelot(from.camelot);
  const b = parseCamelot(to.camelot);
  if (!a || !b) return [];
  const setA = new Set(compatibleKeys(a).map(camelotToString));
  const both = compatibleKeys(b)
    .map(camelotToString)
    .filter((k) => setA.has(k));
  if (both.length === 0) return [];

  const params: Record<string, unknown> = { fromId: from.id, toId: to.id, limit };
  let bpmSql = '';
  if (from.bpm !== null && to.bpm !== null && from.bpm > 0 && to.bpm > 0) {
    params.bpmLo = Math.min(from.bpm, to.bpm) * 0.96;
    params.bpmHi = Math.max(from.bpm, to.bpm) * 1.04;
    bpmSql = 'AND bpm BETWEEN :bpmLo AND :bpmHi';
  }
  const keyList = both.map((_, i) => `:k${i}`).join(', ');
  both.forEach((k, i) => (params[`k${i}`] = k));

  return db
    .prepare(
      `SELECT id, title, artist, bpm, camelot, 0 AS position
       FROM tracks
       WHERE camelot IN (${keyList})
         AND id NOT IN (:fromId, :toId)
         AND needs_review = 0
         ${bpmSql}
       ORDER BY bpm LIMIT :limit`
    )
    .all(params) as PlannerTrack[];
}

export function analyzePlaylist(
  db: BetterSqlite3.Database,
  playlistId: number
): {
  tracks: number;
  transitions: PlannerTransition[];
  problems: number;
  missingData: number;
} {
  const tracks = playlistTracks(db, playlistId);
  const transitions: PlannerTransition[] = [];
  let problems = 0;
  let missingData = 0;
  for (let i = 0; i < tracks.length - 1; i++) {
    const from = tracks[i];
    const to = tracks[i + 1];
    const check = checkTransition(from.camelot, from.bpm, to.camelot, to.bpm);
    const problematic = check.flags.includes('key-clash') || check.flags.includes('bpm-jump');
    if (problematic) problems++;
    if (check.flags.includes('missing-key') || check.flags.includes('missing-bpm')) missingData++;
    transitions.push({
      from,
      to,
      ...check,
      bridges: problematic ? suggestBridges(db, from, to) : []
    });
  }
  return { tracks: tracks.length, transitions, problems, missingData };
}
