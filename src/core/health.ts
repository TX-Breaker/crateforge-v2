import type BetterSqlite3 from 'better-sqlite3';

/**
 * "Salute libreria": pagella READ-ONLY della libreria nell'UDM.
 * Solo COUNT SQL — niente scansioni filesystem (i path rotti hanno già la
 * loro pagina dedicata, il Relocator). Pensata per la modalità Semplice:
 * dice COSA manca e DOVE andare a sistemarlo.
 */

export interface HealthReport {
  total: number;
  missingBpm: number;
  missingKey: number;
  missingGenre: number;
  missingYear: number;
  needsReview: number;
  withoutHotCues: number;
  duplicateGroups: number;
  duplicateTracks: number;
  fingerprinted: number;
  /** 0–100: media pesata delle completezze. */
  score: number;
}

function count(db: BetterSqlite3.Database, sql: string): number {
  return (db.prepare(sql).get() as { c: number }).c;
}

export function computeHealth(db: BetterSqlite3.Database): HealthReport {
  const total = count(db, `SELECT COUNT(*) c FROM tracks`);
  const empty: HealthReport = {
    total: 0, missingBpm: 0, missingKey: 0, missingGenre: 0, missingYear: 0,
    needsReview: 0, withoutHotCues: 0, duplicateGroups: 0, duplicateTracks: 0,
    fingerprinted: 0, score: 0
  };
  if (total === 0) return empty;

  const missingBpm = count(db, `SELECT COUNT(*) c FROM tracks WHERE bpm IS NULL OR bpm <= 0`);
  const missingKey = count(
    db,
    `SELECT COUNT(*) c FROM tracks WHERE camelot IS NULL OR TRIM(camelot) = ''`
  );
  const missingGenre = count(
    db,
    `SELECT COUNT(*) c FROM tracks WHERE genre IS NULL OR TRIM(genre) = ''`
  );
  const missingYear = count(db, `SELECT COUNT(*) c FROM tracks WHERE year IS NULL`);
  const needsReview = count(db, `SELECT COUNT(*) c FROM tracks WHERE needs_review = 1`);
  const withoutHotCues = count(
    db,
    `SELECT COUNT(*) c FROM tracks t
     WHERE NOT EXISTS (SELECT 1 FROM cues WHERE track_id = t.id AND cue_type = 'hot')`
  );
  const dup = db
    .prepare(
      `SELECT COUNT(*) AS groups, COALESCE(SUM(n), 0) AS tracks FROM (
         SELECT COUNT(*) AS n FROM tracks
         WHERE acoustic_id IS NOT NULL
         GROUP BY acoustic_id HAVING COUNT(*) > 1
       )`
    )
    .get() as { groups: number; tracks: number };
  const fingerprinted = count(db, `SELECT COUNT(*) c FROM tracks WHERE acoustic_id IS NOT NULL`);

  // Copie in eccesso = tracce nei gruppi meno un rappresentante per gruppo:
  // una libreria dove ogni brano ha UNA copia non deve azzerare la voce.
  const excessDup = Math.max(0, dup.tracks - dup.groups);
  // Pesi: BPM e key contano di più (servono per suonare), poi pulizia tag.
  const parts: { ok: number; weight: number }[] = [
    { ok: (total - missingBpm) / total, weight: 25 },
    { ok: (total - missingKey) / total, weight: 25 },
    { ok: (total - missingGenre) / total, weight: 15 },
    { ok: (total - missingYear) / total, weight: 10 },
    { ok: (total - needsReview) / total, weight: 15 },
    { ok: (total - excessDup) / total, weight: 10 }
  ];
  const score = Math.round(
    parts.reduce((s, p) => s + p.ok * p.weight, 0) / parts.reduce((s, p) => s + p.weight, 0) * 100
  );

  return {
    total,
    missingBpm,
    missingKey,
    missingGenre,
    missingYear,
    needsReview,
    withoutHotCues,
    duplicateGroups: dup.groups,
    duplicateTracks: dup.tracks,
    fingerprinted,
    score
  };
}
