import ExcelJS from 'exceljs';
import type BetterSqlite3 from 'better-sqlite3';
import type { TrackRow } from '@core/udm';

/**
 * Generatore di Report Excel (§6 Fase 1.3).
 * Export on-demand e per-playlist/selezione: mai l'intera libreria in sincrono.
 * Le righe vengono lette dall'UDM a pagine e scritte in streaming sul file.
 */

export interface ReportOptions {
  outPath: string;
  playlistId?: number; // se assente: tutta la collection (comunque paginata)
  camelotNotation?: boolean;
  groupByArtist?: boolean;
  onProgress?: (done: number, total: number) => void;
}

const PAGE = 1000;

export async function generateExcelReport(
  db: BetterSqlite3.Database,
  opts: ReportOptions
): Promise<{ rows: number; outPath: string }> {
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
    filename: opts.outPath,
    useStyles: true
  });
  const sheet = workbook.addWorksheet('Libreria');

  sheet.columns = [
    { header: 'Artista', key: 'artist', width: 28 },
    { header: 'Titolo', key: 'title', width: 36 },
    { header: 'Versione', key: 'version', width: 18 },
    { header: 'Durata', key: 'duration', width: 10 },
    { header: 'BPM', key: 'bpm', width: 8 },
    { header: 'Key', key: 'key', width: 8 },
    { header: 'Anno', key: 'year', width: 8 },
    { header: 'Genere', key: 'genre', width: 18 },
    { header: 'Path', key: 'path', width: 60 },
    { header: 'Manca tag?', key: 'missing', width: 12 },
    { header: 'Acoustic ID', key: 'acoustic', width: 34 }
  ];
  sheet.getRow(1).font = { bold: true };
  sheet.autoFilter = 'A1:K1';

  const where = opts.playlistId
    ? `WHERE t.id IN (SELECT track_id FROM playlist_tracks WHERE playlist_id = @pl)`
    : '';
  const orderBy = opts.groupByArtist ? 'ORDER BY t.artist, t.title' : 'ORDER BY t.title';
  const total = (
    db
      .prepare(`SELECT COUNT(*) AS c FROM tracks t ${where}`)
      .get({ pl: opts.playlistId }) as { c: number }
  ).c;
  const pageStmt = db.prepare(
    `SELECT t.* FROM tracks t ${where} ${orderBy} LIMIT @limit OFFSET @offset`
  );

  let written = 0;
  let totalSeconds = 0;
  for (let offset = 0; offset < total; offset += PAGE) {
    const rows = pageStmt.all({
      pl: opts.playlistId,
      limit: PAGE,
      offset
    }) as TrackRow[];
    for (const t of rows) {
      const missingTag = t.has_tag_issues === 1;
      const row = sheet.addRow({
        artist: t.artist ?? '',
        title: t.title ?? '',
        version: t.version_label ?? '',
        duration: formatDuration(t.duration_s),
        bpm: t.bpm ?? '',
        key: opts.camelotNotation ? (t.camelot ?? t.musical_key ?? '') : (t.musical_key ?? ''),
        year: t.year ?? '',
        genre: t.genre ?? '',
        path: t.path ?? '',
        missing: missingTag ? 'SÌ' : '',
        acoustic: t.acoustic_id ?? ''
      });
      if (missingTag) {
        // Formattazione condizionale semplice: cella rossa dove manca il tag.
        row.getCell('missing').fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFFFC7CE' }
        };
        row.getCell('missing').font = { color: { argb: 'FF9C0006' }, bold: true };
      }
      totalSeconds += t.duration_s ?? 0;
      row.commit();
      written++;
    }
    opts.onProgress?.(Math.min(offset + PAGE, total), total);
  }

  const totalRow = sheet.addRow({
    artist: 'TOTALE',
    title: `${written} brani`,
    duration: formatDuration(totalSeconds)
  });
  totalRow.font = { bold: true };
  totalRow.commit();

  await workbook.commit();
  return { rows: written, outPath: opts.outPath };
}

export function formatDuration(seconds: number | null): string {
  if (seconds === null || seconds === undefined || Number.isNaN(seconds)) return '';
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? h + ':' : ''}${mm}:${String(sec).padStart(2, '0')}`;
}
