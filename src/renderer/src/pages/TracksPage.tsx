import { useEffect, useState } from 'react';
import { ArrowRight, FileEdit, Music2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { EmptyState, Notice } from '@/components/ui/misc';
import { TrackList, type TrackFilter, type TrackScope } from '@/components/data/TrackList';
import { useAppState } from '@/lib/appState';
import { useLibrary } from '@/lib/library';
import { useRouter } from '@/lib/router';
import { pageText } from '@/lib/i18nPages';

/**
 * Tracce — la libreria per intero, con i filtri che in V1 erano una pagina a sé
 * ("Da revisionare" è ora il filtro `needsReview`, raggiungibile anche dai
 * link della diagnosi).
 *
 * Nessuna azione distruttiva parte da qui: l'esportazione della selezione
 * genera un file, e la quarantena vive in Pulizia con la sua doppia conferma.
 */
export function TracksPage({
  initialSearch,
  initialFilter,
  initialCamelot,
  initialBpm
}: {
  initialSearch?: string;
  initialFilter?: string;
  /** tonalità arrivata da una barra della copertura tonalità */
  initialCamelot?: string;
  /** intervallo "125-130" arrivato da una barra dell'istogramma BPM */
  initialBpm?: string;
}) {
  const { locale } = useAppState();
  const tp = (k: string, p?: Record<string, string | number>) => pageText(locale, 'tracks', k, p);
  const { stats, empty } = useLibrary();
  const { go } = useRouter();
  const [search, setSearch] = useState(initialSearch ?? '');
  const [filters, setFilters] = useState<Set<TrackFilter>>(
    new Set(initialFilter === 'needsReview' ? (['needsReview'] as TrackFilter[]) : [])
  );
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [exported, setExported] = useState<string | null>(null);

  /* Restrizione che arriva dai grafici della panoramica. Vive QUI e non nei
     filtri: i filtri sono scelte dell'utente dentro questa pagina, questa è
     una selezione fatta altrove, e si toglie con la sua X. */
  const parseBpm = (raw?: string): TrackScope | null => {
    const m = raw?.match(/^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/);
    return m ? { bpmMin: Number(m[1]), bpmMax: Number(m[2]) } : null;
  };
  const [scope, setScope] = useState<TrackScope | undefined>(
    initialCamelot ? { camelot: initialCamelot } : (parseBpm(initialBpm) ?? undefined)
  );

  useEffect(() => {
    if (initialSearch !== undefined) setSearch(initialSearch);
    if (initialFilter === 'needsReview') setFilters(new Set(['needsReview']));
    if (initialCamelot) setScope({ camelot: initialCamelot });
    else {
      const b = parseBpm(initialBpm);
      if (b) setScope(b);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSearch, initialFilter, initialCamelot, initialBpm]);

  const toggleFilter = (f: TrackFilter) => {
    setFilters((prev) => {
      const next = new Set(prev);
      next.has(f) ? next.delete(f) : next.add(f);
      return next;
    });
  };

  // L'export di una selezione riusa lo scrittore di set: produce un XML con una
  // playlist che contiene esattamente i brani scelti. Nessuna scrittura sulla
  // collection — si importa a mano in Rekordbox, come sempre.
  const exportSelection = async () => {
    const outPath = await window.crateforge.dialog.saveFile('crateforge-selection.xml', [
      { name: 'Rekordbox XML', extensions: ['xml'] }
    ]);
    if (!outPath) return;
    const name = tp('selectionPlaylist');
    const r = (await window.crateforge.setbuilder.exportXml([...selected], name, outPath)) as {
      written?: number;
    };
    setExported(tp('exportDone', { n: r?.written ?? selected.size, path: outPath }));
  };

  if (empty) {
    return (
      <EmptyState
        icon={<Music2 />}
        title={tp('emptyTitle')}
        action={
          <Button variant="primary" onClick={() => go('overview')}>
            {tp('emptyAction')} <ArrowRight />
          </Button>
        }
      >
        {tp('emptyBody')}
      </EmptyState>
    );
  }

  return (
    <div className="space-y-4">
      {(stats?.needsReview ?? 0) > 0 && (
        <Notice
          variant="warning"
          title={tp('reviewTitle', { n: (stats?.needsReview ?? 0).toLocaleString(locale) })}
          icon={<FileEdit />}
        >
          {tp('reviewBody')}
        </Notice>
      )}

      <TrackList
        search={search}
        onSearchChange={setSearch}
        filters={filters}
        onToggleFilter={toggleFilter}
        scope={scope}
        onClearScope={() => setScope(undefined)}
        selected={selected}
        onSelectedChange={setSelected}
        height={520}
        emptyState={
          <EmptyState
            title={tp('noMatchTitle')}
            action={
              /* L'uscita da "nessun risultato" è tornare a vedere tutto: senza
                 questo bottone l'unico modo era ricordarsi quali filtri si
                 erano accesi. */
              <Button
                variant="secondary"
                onClick={() => {
                  setSearch('');
                  setFilters(new Set());
                  setScope(undefined);
                }}
              >
                {tp('noMatchAction')}
              </Button>
            }
          >
            {tp('noMatchBody')}
          </EmptyState>
        }
        bulkActions={
          <Button size="sm" variant="secondary" onClick={exportSelection}>
            {tp('exportSelection')}
          </Button>
        }
      />

      {exported && (
        <Card>
          <CardHeader>
            <CardTitle className="text-body font-semibold">{tp('exportedTitle')}</CardTitle>
            <CardDescription>{exported}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button size="sm" variant="ghost" onClick={() => go('convert')}>
              {tp('openConvert')} <ArrowRight />
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
