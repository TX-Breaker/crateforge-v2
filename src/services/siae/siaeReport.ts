import ExcelJS from 'exceljs';
import type BetterSqlite3 from 'better-sqlite3';

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
}

export function listHistorySessions(db: BetterSqlite3.Database): HistorySession[] {
  return db
    .prepare(
      `SELECT session_id, session_name, session_date, COUNT(*) AS tracks
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
}

export async function exportSiaeReport(
  db: BetterSqlite3.Database,
  opts: SiaeExportOptions
): Promise<{ rows: number; outPath: string }> {
  const rows = db
    .prepare(
      `SELECT position, title, artist, album, genre, year, duration_s, isrc, label
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
  }[];

  const wb = new ExcelJS.Workbook();
  wb.creator = 'CrateForge';
  const ws = wb.addWorksheet('SIAE');

  // Intestazione evento (i campi che la SIAE chiede sul modulo).
  ws.addRow(['Programma musicale — brani riprodotti']);
  ws.getRow(1).font = { bold: true, size: 14 };
  ws.addRow(['Locale/Evento', opts.venue ?? '']);
  ws.addRow(['Data', opts.eventDate ?? '']);
  ws.addRow([]);

  const headerRow = ws.addRow([
    'N.',
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
  ws.autoFilter = { from: { row: 5, column: 1 }, to: { row: 5, column: 8 } };

  await wb.xlsx.writeFile(opts.outPath);
  return { rows: rows.length, outPath: opts.outPath };
}
