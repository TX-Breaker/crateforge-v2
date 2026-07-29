import ExcelJS from 'exceljs';
import { statSync } from 'fs';

/**
 * Visualizzatore di report Excel (fase intermedia): legge un .xlsx generato
 * (o qualsiasi xlsx) e restituisce pagine di righe al renderer — mai l'intero
 * file in un colpo solo (§2: no bulk data su IPC).
 *
 * Cache del workbook: il parsing di un .xlsx costa (decompressione + XML), e
 * sfogliare le pagine rileggeva OGNI VOLTA l'intero file — su un report di
 * decine di migliaia di righe ogni clic "pagina successiva" ricominciava da
 * zero. Teniamo in cache l'ultimo workbook aperto, invalidandolo quando il
 * file cambia (mtime/size) così un report rigenerato non viene mai servito
 * stantio.
 */

export interface ReportPageResult {
  columns: string[];
  rows: (string | number | null)[][];
  totalRows: number;
  sheetName: string;
}

function cellToPlain(v: ExcelJS.CellValue): string | number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number' || typeof v === 'string') return v;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if ('richText' in v) return v.richText.map((r) => r.text).join('');
    if ('text' in v) return String(v.text);
    if ('result' in v) return cellToPlain(v.result as ExcelJS.CellValue);
  }
  return String(v);
}

interface CachedWorkbook {
  filePath: string;
  mtimeMs: number;
  size: number;
  wb: ExcelJS.Workbook;
}

// Un solo elemento: si sfoglia un report alla volta, e tenerne più d'uno
// significherebbe trattenere in memoria file grandi senza motivo.
let cache: CachedWorkbook | null = null;

/** Svuota la cache (usata alla chiusura o dopo la rigenerazione di un report). */
export function clearReportCache(): void {
  cache = null;
}

async function loadWorkbook(filePath: string): Promise<ExcelJS.Workbook> {
  const st = statSync(filePath);
  if (
    cache &&
    cache.filePath === filePath &&
    cache.mtimeMs === st.mtimeMs &&
    cache.size === st.size
  ) {
    return cache.wb;
  }
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  cache = { filePath, mtimeMs: st.mtimeMs, size: st.size, wb };
  return wb;
}

export async function readReportPage(
  filePath: string,
  offset: number,
  limit: number
): Promise<ReportPageResult> {
  const wb = await loadWorkbook(filePath);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error('Il file non contiene fogli di lavoro.');

  const headerRow = ws.getRow(1);
  const columns: string[] = [];
  headerRow.eachCell({ includeEmpty: true }, (cell, col) => {
    columns[col - 1] = String(cellToPlain(cell.value) ?? `Colonna ${col}`);
  });

  const totalRows = Math.max(0, ws.rowCount - 1);
  const rows: (string | number | null)[][] = [];
  const start = 2 + Math.max(0, offset);
  const end = Math.min(ws.rowCount, start + Math.min(limit, 500) - 1);
  for (let r = start; r <= end; r++) {
    const row = ws.getRow(r);
    const values: (string | number | null)[] = new Array(columns.length).fill(null);
    row.eachCell({ includeEmpty: false }, (cell, col) => {
      if (col - 1 < columns.length) values[col - 1] = cellToPlain(cell.value);
    });
    rows.push(values);
  }
  return { columns, rows, totalRows, sheetName: ws.name };
}
