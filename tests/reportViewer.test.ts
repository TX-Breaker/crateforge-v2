import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import ExcelJS from 'exceljs';
import { clearReportCache, readReportPage } from '@services/excel/reportViewer';

/**
 * Il visualizzatore tiene in cache l'ultimo workbook per non riparsare
 * l'intero .xlsx a ogni pagina. La cache è utile solo se non serve MAI dati
 * vecchi: qui si verifica che un file rigenerato venga riletto.
 */

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cf-report-'));
  clearReportCache();
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

async function writeXlsx(path: string, rows: string[][]): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Report');
  ws.addRow(['Titolo', 'Artista']);
  for (const r of rows) ws.addRow(r);
  await wb.xlsx.writeFile(path);
}

describe('readReportPage', () => {
  it('pagina le righe e restituisce lo stesso contenuto a ogni rilettura', async () => {
    const p = join(dir, 'r.xlsx');
    await writeXlsx(p, [
      ['A', 'Uno'],
      ['B', 'Due'],
      ['C', 'Tre']
    ]);

    const first = await readReportPage(p, 0, 2);
    expect(first.rows).toHaveLength(2);
    expect(first.rows[0]).toEqual(['A', 'Uno']);
    expect(first.totalRows).toBe(3);
    expect(first.columns).toEqual(['Titolo', 'Artista']);

    // Seconda pagina servita dalla cache: stesso file, contenuto coerente.
    const second = await readReportPage(p, 2, 2);
    expect(second.rows).toHaveLength(1);
    expect(second.rows[0]).toEqual(['C', 'Tre']);
  });

  it('rilegge il file quando cambia, invece di servire la cache stantia', async () => {
    const p = join(dir, 'r.xlsx');
    await writeXlsx(p, [['A', 'Uno']]);
    const before = await readReportPage(p, 0, 10);
    expect(before.rows).toHaveLength(1);

    // Report rigenerato con contenuto diverso: mtime e dimensione cambiano.
    await new Promise((r) => setTimeout(r, 20));
    await writeXlsx(p, [
      ['X', 'Nuovo'],
      ['Y', 'Anche']
    ]);
    const after = await readReportPage(p, 0, 10);
    expect(after.rows).toHaveLength(2);
    expect(after.rows[0]).toEqual(['X', 'Nuovo']);
  });
});
