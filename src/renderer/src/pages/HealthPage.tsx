import { ArrowRight, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, Eyebrow } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { EmptyState, Meter } from '@/components/ui/misc';
import { HealthRing } from '@/components/data/Charts';
import { RekordboxDiff } from '@/components/RekordboxDiff';
import { useAppState } from '@/lib/appState';
import { useLibrary } from '@/lib/library';
import { useRouter } from '@/lib/router';
import { pageText } from '@/lib/i18nPages';
import type { RouteId } from '@/app/routes';

/**
 * Salute libreria: read-only. Punteggio, righe "cosa manca / dove sistemarlo"
 * e nient'altro — nessuna azione parte da qui, solo diagnosi onesta con il
 * collegamento alla pagina che risolve.
 */
export function HealthPage() {
  const { locale } = useAppState();
  const tp = (k: string, p?: Record<string, string | number>) => pageText(locale, 'health', k, p);
  const { health, refresh, empty } = useLibrary();
  const { go } = useRouter();

  if (empty || !health || health.total === 0) {
    return (
      <EmptyState
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

  const rows: {
    label: string;
    value: number;
    hint?: string;
    tone?: 'warning' | 'accent' | 'success';
    route?: [RouteId, string?];
  }[] = [
    { label: tp('rowBpm'), value: health.missingBpm },
    { label: tp('rowKey'), value: health.missingKey },
    {
      label: tp('rowGenre'),
      value: health.missingGenre,
      hint: tp('hintTagger'),
      route: ['enrich', 'tags']
    },
    {
      label: tp('rowYear'),
      value: health.missingYear,
      hint: tp('hintTagger'),
      route: ['enrich', 'tags']
    },
    { label: tp('rowReview'), value: health.needsReview, hint: tp('hintReview'), route: ['tracks'] },
    {
      label: tp('rowDup'),
      value: health.duplicateTracks,
      hint: tp('dupNote', {
        groups: health.duplicateGroups.toLocaleString(locale),
        tracks: health.duplicateTracks.toLocaleString(locale)
      }),
      route: ['cleanup', 'duplicates']
    },
    {
      label: tp('rowCues'),
      value: health.withoutHotCues,
      hint: tp('hintCues'),
      route: ['enrich', 'cues']
    },
    {
      label: tp('rowFp'),
      value: health.fingerprinted,
      hint: tp('hintFp'),
      tone: 'success',
      route: ['cleanup', 'duplicates']
    }
  ];

  return (
    <div className="space-y-4">
      <RekordboxDiff page="health" />

      <Card>
        <CardContent className="flex flex-wrap items-center gap-6 p-5">
          <HealthRing score={health.score} label={tp('outOf')} />
          <div className="min-w-[220px] flex-1 space-y-1">
            <Eyebrow>{tp('scoreLabel')}</Eyebrow>
            <div className="text-section text-ink-hi">
              {health.score >= 85
                ? tp('scoreGood')
                : health.score >= 60
                  ? tp('scoreMid')
                  : tp('scoreBad')}
            </div>
            <p className="text-caption text-ink-mid">
              {tp('totalTracks', { n: health.total.toLocaleString(locale) })}
            </p>
          </div>
          <Button variant="secondary" size="sm" onClick={refresh}>
            <RefreshCw /> {tp('refresh')}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-body">{tp('breakdownTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {rows.map((r, i) => (
            <Meter
              key={i}
              label={r.label}
              value={r.value}
              total={health.total}
              tone={r.tone ?? 'warning'}
              hint={
                r.hint ? (
                  <span className="flex flex-wrap items-center gap-2">
                    {r.hint}
                    {r.route && (
                      <button
                        onClick={() => go(r.route![0], r.route![1])}
                        className="text-accent underline-offset-2 transition-colors duration-press hover:underline"
                      >
                        {tp('openFix')} →
                      </button>
                    )}
                  </span>
                ) : undefined
              }
            />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
