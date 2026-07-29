import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Search, X } from 'lucide-react';
import { cn, formatDuration } from '@/lib/utils';
import { useAppState } from '@/lib/appState';
import { useLibrary } from '@/lib/library';
import { t } from '@/lib/i18n';
import { Badge, Checkbox, FilterChip, Input, Segmented, Skeleton } from '@/components/ui/misc';

/**
 * Lista tracce virtualizzata (§5.3). Un solo componente serve Tracce, Pulizia,
 * Ritrova e Set: le righe sono finestrate, quindi una libreria da 50.000 brani
 * scorre a frame rate.
 *
 * La selezione sopravvive a scroll, filtro e ordinamento; la barra delle azioni
 * di massa compare solo quando c'è una selezione ed è agganciata al fondo della
 * lista, non della finestra, così non copre mai la statusbar.
 *
 * Dato mancante = trattino lungo in colonna mono PIÙ un badge che dice cosa
 * manca: una cella vuota si legge come "va tutto bene".
 */

export interface Track {
  id: number;
  title: string | null;
  artist: string | null;
  bpm: number | null;
  camelot: string | null;
  duration_s: number | null;
  genre: string | null;
  path: string | null;
  needs_review: number;
  review_reason: string | null;
  acoustic_id: string | null;
}

export type TrackFilter = 'needsReview' | 'noKey' | 'noBpm' | 'noGenre';

/**
 * Restrizione che arriva da FUORI l'elenco — oggi da una barra dei grafici
 * della panoramica. Non è un chip come gli altri: i chip sono scelte che
 * l'utente fa qui dentro e che restano sue, questa è un contesto in cui è
 * entrato da un'altra pagina, e va mostrata come tale con la sua via d'uscita.
 */
export interface TrackScope {
  camelot?: string;
  bpmMin?: number;
  bpmMax?: number;
}

const PAGE = 200;

export function TrackList({
  search,
  onSearchChange,
  filters,
  onToggleFilter,
  scope,
  onClearScope,
  selected,
  onSelectedChange,
  bulkActions,
  height = 460,
  emptyState
}: {
  search: string;
  onSearchChange: (v: string) => void;
  filters: Set<TrackFilter>;
  onToggleFilter: (f: TrackFilter) => void;
  /** restrizione arrivata da un grafico; `onClearScope` è la via d'uscita */
  scope?: TrackScope;
  onClearScope?: () => void;
  selected: Set<number>;
  onSelectedChange: (s: Set<number>) => void;
  bulkActions?: React.ReactNode;
  height?: number;
  emptyState?: React.ReactNode;
}) {
  const { locale, density, setDensity } = useAppState();
  /* Conteggi dei chip: già calcolati altrove (statistiche e diagnosi), qui si
     leggono soltanto — un chip non deve interrogare il database per sapere
     come chiamarsi. */
  const { stats, health } = useLibrary();
  const [rows, setRows] = useState<(Track | undefined)[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const requested = useRef<Set<number>>(new Set());
  const scroller = useRef<HTMLDivElement | null>(null);
  const lastClicked = useRef<number | null>(null);
  const [debounced, setDebounced] = useState(search);

  useEffect(() => {
    const h = setTimeout(() => setDebounced(search), 220);
    return () => clearTimeout(h);
  }, [search]);

  const needsReviewOnly = filters.has('needsReview');
  /* Tutti i filtri vengono applicati dal database. Prima i tre "manca il dato"
     erano applicati alla sola pagina scaricata: l'elenco mostrava buchi bianchi
     dove le righe erano state nascoste, e il totale continuava a contare anche
     quelle. Su una libreria grande significava un contatore che diceva 50.000
     mentre a schermo se ne vedevano trenta. */
  const noKey = filters.has('noKey');
  const noBpm = filters.has('noBpm');
  const noGenre = filters.has('noGenre');
  /* Chiave stabile: l'oggetto `scope` è nuovo a ogni render del genitore, e
     come dipendenza rilancerebbe la query all'infinito. */
  const scopeKey = `${scope?.camelot ?? ''}|${scope?.bpmMin ?? ''}|${scope?.bpmMax ?? ''}`;

  // Cambiare ricerca o filtri azzera la finestra: le pagine già scaricate non
  // valgono più.
  useEffect(() => {
    requested.current = new Set();
    setLoading(true);
    (async () => {
      const r = (await window.crateforge.library.page({
        offset: 0,
        limit: PAGE,
        search: debounced || undefined,
        needsReview: needsReviewOnly ? true : undefined,
        noKey: noKey || undefined,
        noBpm: noBpm || undefined,
        noGenre: noGenre || undefined,
        camelot: scope?.camelot,
        bpmMin: scope?.bpmMin,
        bpmMax: scope?.bpmMax
      })) as { rows: Track[]; total: number };
      const next: (Track | undefined)[] = new Array(r.total);
      r.rows.forEach((row, i) => (next[i] = row));
      requested.current.add(0);
      setRows(next);
      setTotal(r.total);
      setLoading(false);
      scroller.current?.scrollTo({ top: 0 });
    })();
  }, [debounced, needsReviewOnly, noKey, noBpm, noGenre, scopeKey]);

  const loadPage = useCallback(
    async (page: number) => {
      if (requested.current.has(page)) return;
      requested.current.add(page);
      const r = (await window.crateforge.library.page({
        offset: page * PAGE,
        limit: PAGE,
        search: debounced || undefined,
        needsReview: needsReviewOnly ? true : undefined,
        noKey: noKey || undefined,
        noBpm: noBpm || undefined,
        noGenre: noGenre || undefined,
        camelot: scope?.camelot,
        bpmMin: scope?.bpmMin,
        bpmMax: scope?.bpmMax
      })) as { rows: Track[]; total: number };
      setRows((prev) => {
        const next = prev.slice();
        r.rows.forEach((row, i) => (next[page * PAGE + i] = row));
        return next;
      });
    },
    [debounced, needsReviewOnly, noKey, noBpm, noGenre, scopeKey]
  );

  const rowH = density === 'compact' ? 30 : 46;

  const virtualizer = useVirtualizer({
    count: total,
    getScrollElement: () => scroller.current,
    estimateSize: () => rowH,
    overscan: 12
  });

  useEffect(() => {
    virtualizer.measure();
  }, [rowH, virtualizer]);

  const items = virtualizer.getVirtualItems();
  useEffect(() => {
    for (const it of items) loadPage(Math.floor(it.index / PAGE));
  }, [items, loadPage]);

  const toggle = (id: number, index: number, e: React.MouseEvent) => {
    const next = new Set(selected);
    if (e.shiftKey && lastClicked.current !== null) {
      const [a, b] = [lastClicked.current, index].sort((x, y) => x - y);
      for (let i = a; i <= b; i++) {
        const row = rows[i];
        if (row) next.add(row.id);
      }
    } else if (e.metaKey || e.ctrlKey) {
      next.has(id) ? next.delete(id) : next.add(id);
    } else {
      next.has(id) ? next.delete(id) : next.add(id);
    }
    lastClicked.current = index;
    onSelectedChange(next);
  };

  /* Contatori dei chip (§8.2): i numeri ci sono GIÀ — needs_review sta nelle
     statistiche, i tre "manca il dato" nella diagnosi — quindi si mostrano.
     Se la diagnosi non è ancora arrivata il chip non porta numero: mai un
     indicatore di caricamento, mai il conteggio della scansione precedente. */
  /** Etichetta della restrizione: "Tonalità 8A" oppure "125–130 BPM". */
  const scopeLabel = scope?.camelot
    ? `${t(locale, 'tracks.colKey')} ${scope.camelot}`
    : scope?.bpmMin !== undefined
      ? `${scope.bpmMin}–${scope.bpmMax ?? ''} ${t(locale, 'tracks.colBpm')}`
      : null;

  const filterChips: { id: TrackFilter; label: string; count?: number }[] = useMemo(
    () => [
      { id: 'needsReview', label: t(locale, 'filter.needsReview'), count: stats?.needsReview },
      { id: 'noKey', label: t(locale, 'filter.noKey'), count: health?.missingKey },
      { id: 'noBpm', label: t(locale, 'filter.noBpm'), count: health?.missingBpm },
      { id: 'noGenre', label: t(locale, 'filter.noGenre'), count: health?.missingGenre }
    ],
    [locale, stats, health]
  );

  return (
    <div className="overflow-hidden rounded-card border border-line-subtle bg-surface-2">
      {/* barra strumenti */}
      <div className="flex flex-wrap items-center gap-2 border-b border-line-subtle px-3 py-2.5">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-lo" />
          <Input
            className="pl-8"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={t(locale, 'tracks.searchPh')}
          />
        </div>
        {/* Restrizione arrivata da un grafico. Sta PRIMA dei chip e porta una
            X: è il contesto in cui l'utente è entrato, e deve poterne uscire
            senza tornare indietro a memoria. */}
        {scopeLabel && (
          <button
            type="button"
            onClick={onClearScope}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border border-accent bg-accent/15 px-2.5 py-1',
              'text-caption text-accent transition-colors duration-press hover:bg-accent/25'
            )}
          >
            {scopeLabel}
            <X className="size-3" />
          </button>
        )}
        {filterChips.map((f) => (
          <FilterChip
            key={f.id}
            active={filters.has(f.id)}
            count={f.count}
            onClick={() => onToggleFilter(f.id)}
          >
            {f.label}
          </FilterChip>
        ))}
        <span className="ml-auto font-mono text-caption tabular-nums text-ink-lo">
          {total.toLocaleString(locale)}
        </span>
        <Segmented
          size="sm"
          value={density}
          onChange={setDensity}
          options={[
            { value: 'comfortable', label: t(locale, 'density.comfortable') },
            { value: 'compact', label: t(locale, 'density.compact') }
          ]}
        />
      </div>

      {/* intestazione colonne */}
      <div className="flex items-center gap-3 border-b border-line-subtle bg-surface-3 px-3 py-1.5 font-mono text-[9.5px] uppercase tracking-[.12em] text-ink-lo">
        <span className="w-4 shrink-0" />
        <span className="flex-1">{t(locale, 'tracks.colTrack')}</span>
        <span className="w-14 shrink-0 text-right">{t(locale, 'tracks.colBpm')}</span>
        <span className="w-10 shrink-0 text-right">{t(locale, 'tracks.colKey')}</span>
        <span className="w-12 shrink-0 text-right">{t(locale, 'tracks.colLength')}</span>
        <span className="w-40 shrink-0">{t(locale, 'tracks.colStatus')}</span>
      </div>

      {/* corpo virtualizzato */}
      {loading ? (
        <div className="space-y-1 p-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-[var(--row-h)] w-full" />
          ))}
        </div>
      ) : total === 0 ? (
        <div className="p-4">{emptyState}</div>
      ) : (
        <div ref={scroller} className="overflow-y-auto" style={{ height }}>
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {items.map((v) => {
              const tr = rows[v.index];
              const isSel = tr ? selected.has(tr.id) : false;
              return (
                <div
                  key={v.key}
                  className={cn(
                    'absolute left-0 top-0 flex w-full items-center gap-3 border-b border-line-subtle px-3',
                    'transition-colors duration-press hover:bg-surface-hover',
                    isSel && 'bg-accent/10'
                  )}
                  style={{ height: v.size, transform: `translateY(${v.start}px)` }}
                  onClick={(e) => tr && toggle(tr.id, v.index, e)}
                >
                  {tr ? (
                    <>
                      <Checkbox
                        className="shrink-0"
                        checked={isSel}
                        // Il nome accessibile della riga: senza, uno screen reader
                        // annuncia ventiquattro caselle identiche e mute.
                        aria-label={`${tr.artist ?? '?'} — ${tr.title ?? '?'}`}
                        onClick={(e) => e.stopPropagation()}
                        onCheckedChange={() => {
                          const next = new Set(selected);
                          next.has(tr.id) ? next.delete(tr.id) : next.add(tr.id);
                          onSelectedChange(next);
                        }}
                      />
                      <span
                        className="min-w-0 flex-1 truncate text-ink-hi"
                        style={{ fontSize: 'var(--row-font)' }}
                        title={tr.path ?? undefined}
                      >
                        <span className="text-ink-mid">{tr.artist ?? '—'}</span>
                        <span className="text-ink-lo"> — </span>
                        {tr.title ?? '—'}
                      </span>
                      <span className="w-14 shrink-0 text-right font-mono text-data tabular-nums text-ink-mid">
                        {tr.bpm ? tr.bpm.toFixed(1) : '—'}
                      </span>
                      <span
                        className={cn(
                          'w-10 shrink-0 text-right font-mono text-data tabular-nums',
                          tr.camelot ? 'text-accent' : 'text-ink-lo'
                        )}
                      >
                        {tr.camelot ?? '—'}
                      </span>
                      <span className="w-12 shrink-0 text-right font-mono text-data tabular-nums text-ink-mid">
                        {formatDuration(tr.duration_s)}
                      </span>
                      <span className="flex w-40 shrink-0 flex-wrap gap-1">
                        {tr.needs_review === 1 && (
                          <Badge variant="warning">{t(locale, 'badge.review')}</Badge>
                        )}
                        {!tr.camelot && <Badge variant="neutral">{t(locale, 'badge.noKey')}</Badge>}
                        {!tr.genre && <Badge variant="neutral">{t(locale, 'badge.noGenre')}</Badge>}
                      </span>
                    </>
                  ) : (
                    <Skeleton className="h-3 w-full" />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* barra azioni di massa */}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 border-t border-line bg-surface-3 px-3 py-2 animate-slide-up">
          <span className="font-mono text-data tabular-nums text-ink-hi">
            {selected.size.toLocaleString(locale)} {t(locale, 'common.selected')}
          </span>
          <span className="text-caption text-ink-lo">{t(locale, 'tracks.selectionHint')}</span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <button
              onClick={() => onSelectedChange(new Set())}
              className="text-caption text-ink-lo transition-colors duration-press hover:text-ink-hi"
            >
              {t(locale, 'common.clear')}
            </button>
            {bulkActions}
          </div>
        </div>
      )}
    </div>
  );
}
