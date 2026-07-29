import { useCallback, useEffect, useRef, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Notice, Skeleton } from '@/components/ui/misc';
import { useAppState } from '@/lib/appState';
import { pageText } from '@/lib/i18nPages';
import { shortenPath } from '@/lib/utils';

interface ViewerData {
  columns: string[];
  rows: (string | number | null)[][];
  totalRows: number;
  sheetName: string;
}

const PAGE_SIZE = 200;
const DEFAULT_WIDTH = 140;
const MIN_WIDTH = 60;
const WIDTHS_KEY = 'reportViewer.colWidths';

/**
 * Anteprima di un report .xlsx dentro l'app.
 * - righe paginate (mai il file intero in memoria del renderer);
 * - scroll orizzontale per le molte colonne;
 * - larghezza colonne regolabile con trascinamento, PERSISTITA (per nome
 *   colonna) nelle impostazioni e resettabile.
 */
export function ExcelViewer({ filePath }: { filePath: string }) {
  const { locale } = useAppState();
  const tp = (k: string, p?: Record<string, string | number>) => pageText(locale, 'report', k, p);
  const tc = (k: string, p?: Record<string, string | number>) => pageText(locale, 'common', k, p);
  const [data, setData] = useState<ViewerData | null>(null);
  const [page, setPage] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [widths, setWidths] = useState<Record<string, number>>({});
  const dragState = useRef<{ col: string; startX: number; startW: number } | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    window.crateforge.settings.get(WIDTHS_KEY).then((v) => {
      if (v) {
        try {
          setWidths(JSON.parse(v));
        } catch {
          // impostazione corrotta: si riparte dai default
        }
      }
    });
  }, []);

  useEffect(() => {
    setError(null);
    window.crateforge.report
      .view(filePath, page * PAGE_SIZE, PAGE_SIZE)
      .then(setData)
      .catch((err: unknown) => setError(String(err)));
  }, [filePath, page]);

  const persistWidths = (w: Record<string, number>) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(
      () => window.crateforge.settings.set(WIDTHS_KEY, JSON.stringify(w)),
      400
    );
  };

  const onDragStart = (col: string, e: React.MouseEvent) => {
    e.preventDefault();
    dragState.current = { col, startX: e.clientX, startW: widths[col] ?? DEFAULT_WIDTH };
    const onMove = (ev: MouseEvent) => {
      const s = dragState.current;
      if (!s) return;
      const w = Math.max(MIN_WIDTH, s.startW + (ev.clientX - s.startX));
      setWidths((prev) => {
        const next = { ...prev, [s.col]: w };
        persistWidths(next);
        return next;
      });
    };
    const onUp = () => {
      dragState.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const resetWidths = useCallback(() => {
    setWidths({});
    window.crateforge.settings.set(WIDTHS_KEY, '{}');
  }, []);

  if (error) {
    return <Notice variant="destructive">{tp('viewerErr', { msg: error })}</Notice>;
  }
  if (!data) {
    return (
      <div className="space-y-1.5">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-6 w-full" />
        ))}
      </div>
    );
  }

  const totalPages = Math.max(1, Math.ceil(data.totalRows / PAGE_SIZE));

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-caption text-ink-lo">
        <span className="min-w-0 flex-1 truncate font-mono" title={filePath}>
          {shortenPath(filePath, 46)}
        </span>
        <span className="shrink-0">
          {data.sheetName} · {data.totalRows.toLocaleString(locale)}
        </span>
        <Button variant="ghost" size="sm" onClick={resetWidths}>
          <RotateCcw /> {tp('resetCols')}
        </Button>
      </div>

      <div className="max-h-[26rem] overflow-auto rounded-card border border-line-subtle">
        <table
          className="text-caption"
          style={{ borderCollapse: 'collapse', tableLayout: 'fixed' }}
        >
          <thead className="sticky top-0 z-10 bg-surface-3">
            <tr>
              {data.columns.map((c) => (
                <th
                  key={c}
                  className="relative select-none border-b border-r border-line-subtle px-2 py-1.5 text-left font-mono text-[9.5px] uppercase tracking-[.1em] text-ink-lo last:border-r-0"
                  style={{ width: widths[c] ?? DEFAULT_WIDTH, minWidth: MIN_WIDTH }}
                >
                  <span className="block truncate">{c}</span>
                  <span
                    onMouseDown={(e) => onDragStart(c, e)}
                    className="absolute -right-1 top-0 z-20 h-full w-2 cursor-col-resize"
                    title={tp('dragToResize')}
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row, ri) => (
              <tr key={ri} className="odd:bg-surface-3/40">
                {data.columns.map((c, ci) => (
                  <td
                    key={ci}
                    className="truncate border-b border-r border-line-subtle px-2 py-1 text-ink-mid last:border-r-0"
                    style={{
                      width: widths[c] ?? DEFAULT_WIDTH,
                      maxWidth: widths[c] ?? DEFAULT_WIDTH
                    }}
                    title={row[ci] === null ? '' : String(row[ci])}
                  >
                    {row[ci] === null ? '' : String(row[ci])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center gap-2 text-caption text-ink-lo">
          <Button variant="ghost" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
            {tc('prev')}
          </Button>
          {tc('pageOf', { p: page + 1, tot: totalPages })}
          <Button
            variant="ghost"
            size="sm"
            disabled={page + 1 >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            {tc('next')}
          </Button>
        </div>
      )}
    </div>
  );
}
