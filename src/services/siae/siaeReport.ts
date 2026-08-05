import ExcelJS from 'exceljs';
import type BetterSqlite3 from 'better-sqlite3';
import { filterSessionRows, minutesOfTimestamp } from './siaeWindow';

/**
 * Report SIAE dei brani riprodotti in una serata (§ nuova funzione).
 * I dati arrivano dalla cronologia di Rekordbox (tabella play_history,
 * popolata dal sidecar via read-history). Genera un .xlsx nel formato tipico
 * dei "programmi musicali" SIAE. Onestà: alcuni campi (ISRC, autore/editore)
 * spesso non sono in Rekordbox — le colonne restano, vuote dove il dato manca.
 */

export interface HistorySession {
  session_id: string;
  session_name: string | null;
  session_date: string | null;
  tracks: number;
  /** ora del primo e dell'ultimo brano, se la cronologia le porta */
  first_played_at: string | null;
  last_played_at: string | null;
}

/** Sotto questa durata un brano è un sample, non un'opera riprodotta. */
export const SAMPLE_UNDER_S = 30;

export function listHistorySessions(db: BetterSqlite3.Database): HistorySession[] {
  return db
    .prepare(
      `SELECT session_id, session_name, session_date, COUNT(*) AS tracks,
              MIN(played_at) AS first_played_at, MAX(played_at) AS last_played_at
       FROM play_history
       GROUP BY session_id
       ORDER BY session_date DESC, session_name`
    )
    .all() as HistorySession[];
}

function fmtDuration(s: number | null): string {
  if (s == null || s <= 0) return '';
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.round(s % 60)).padStart(2, '0')}`;
}

export interface SiaeExportOptions {
  sessionId: string;
  outPath: string;
  venue?: string;
  eventDate?: string;
  /** inizio della fascia, `21:00`; senza coppia from/to non si filtra */
  fromTime?: string;
  /** fine della fascia, `06:00` — passare la mezzanotte è il caso normale */
  toTime?: string;
  /** durata sotto la quale il brano è un sample; 0 = tieni tutto */
  sampleUnderS?: number;
}

export interface SiaeExportResult {
  rows: number;
  outPath: string;
  /** righe tolte perché fuori dalla fascia oraria */
  outOfWindow: number;
  /** righe tolte perché più corte della soglia */
  samples: number;
  /** righe TENUTE pur non avendo un orario: non erano giudicabili */
  unknownTime: number;
}

/** `2026-08-05 23:40:12` → `23:40`, e niente se l'orario non c'è. */
function fmtClock(iso: string | null): string {
  const m = minutesOfTimestamp(iso);
  if (m === null) return '';
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export async function exportSiaeReport(
  db: BetterSqlite3.Database,
  opts: SiaeExportOptions
): Promise<SiaeExportResult> {
  const all = db
    .prepare(
      `SELECT position, title, artist, album, genre, year, duration_s, isrc, label, played_at
       FROM play_history WHERE session_id = ? ORDER BY position`
    )
    .all(opts.sessionId) as {
    position: number;
    title: string | null;
    artist: string | null;
    album: string | null;
    genre: string | null;
    year: number | null;
    duration_s: number | null;
    isrc: string | null;
    label: string | null;
    played_at: string | null;
  }[];

  /* Chi entra e chi no lo decide una funzione sola, testata a parte: qui si
     scrive il foglio, non si discute il criterio. */
  const { rows, counts } = filterSessionRows(all, {
    fromTime: opts.fromTime,
    toTime: opts.toTime,
    sampleUnderS: opts.sampleUnderS
  });

  const wb = new ExcelJS.Workbook();
  wb.creator = 'CrateForge';
  const ws = wb.addWorksheet('SIAE');

  // Intestazione evento (i campi che la SIAE chiede sul modulo).
  ws.addRow(['Programma musicale — brani riprodotti']);
  ws.getRow(1).font = { bold: true, size: 14 };
  ws.addRow(['Locale/Evento', opts.venue ?? '']);
  ws.addRow(['Data', opts.eventDate ?? '']);
  /* Le esclusioni stanno IN TESTA al foglio, non in fondo e non solo a schermo:
     chi riceve il programma musicale deve poter vedere che una parte dei brani
     è stata tolta, quanti, e con quale criterio. */
  ws.addRow([
    'Fascia oraria',
    opts.fromTime && opts.toTime ? `${opts.fromTime} → ${opts.toTime}` : 'intera sessione'
  ]);
  ws.addRow([
    'Esclusi come sample',
    counts.samples > 0 ? `${counts.samples} (durata sotto ${opts.sampleUnderS ?? 0}s)` : '0'
  ]);
  ws.addRow(['Esclusi fuori fascia', counts.outOfWindow]);
  if (counts.unknownTime > 0) {
    ws.addRow([
      'Inclusi senza orario',
      `${counts.unknownTime} — la cronologia non riporta l'ora: tenuti per non perderli`
    ]);
  }
  ws.addRow([]);

  const headerRow = ws.addRow([
    'N.',
    'Ora',
    'Titolo',
    'Autore/Interprete',
    'Album/Etichetta',
    'Anno',
    'Durata',
    'ISRC',
    'Genere'
  ]);
  headerRow.font = { bold: true };
  ws.columns = [
    { width: 5 },
    { width: 7 },
    { width: 36 },
    { width: 28 },
    { width: 26 },
    { width: 7 },
    { width: 9 },
    { width: 16 },
    { width: 16 }
  ];

  rows.forEach((r, i) => {
    ws.addRow([
      i + 1,
      fmtClock(r.played_at),
      r.title ?? '',
      r.artist ?? '',
      r.label ?? r.album ?? '',
      r.year ?? '',
      fmtDuration(r.duration_s),
      r.isrc ?? '',
      r.genre ?? ''
    ]);
  });

  ws.addRow([]);
  ws.addRow(['Totale brani', rows.length]);
  ws.autoFilter = { from: { row: headerRow.number, column: 1 }, to: { row: headerRow.number, column: 9 } };

  await wb.xlsx.writeFile(opts.outPath);
  return {
    rows: rows.length,
    outPath: opts.outPath,
    outOfWindow: counts.outOfWindow,
    samples: counts.samples,
    unknownTime: counts.unknownTime
  };
}
