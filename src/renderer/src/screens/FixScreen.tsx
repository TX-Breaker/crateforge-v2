import { useState } from 'react';
import {
  Archive,
  CalendarDays,
  ChevronRight,
  Copy,
  FileSearch,
  FileWarning,
  FolderSearch,
  Gauge,
  KeyRound,
  Layers,
  MapPin,
  Tag
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/misc';
import { InfoTip, PageHeader, Section } from '@/components/ui/page';
import { useAppState } from '@/lib/appState';
import { useLibrary } from '@/lib/library';
import { useRouter } from '@/lib/router';
import { healthIssues, type IssueId } from '@/lib/issues';
import { useT, type StrKey } from '@/lib/strings';
import { cn } from '@/lib/utils';
import { AutoCueSheet } from './fix/AutoCueSheet';
import { DuplicatesSheet } from './fix/DuplicatesSheet';
import { OrphansSheet } from './fix/OrphansSheet';
import { QuarantineSheet } from './fix/QuarantineSheet';
import { RelocateSheet } from './fix/RelocateSheet';
import { StemsSheet } from './fix/StemsSheet';
import { TagsSheet } from './fix/TagsSheet';

/**
 * Da sistemare: un elenco, una riga per problema, un pulsante per riga.
 *
 * Le righe vengono dal rapporto di salute e stanno in ordine di urgenza; ciò
 * che è già in ordine si riduce a una riga sola in fondo. Ogni pulsante apre
 * lo strumento in un pannello laterale, o porta alla libreria già filtrata
 * quando la correzione si fa nel programma DJ.
 */

type Tool = 'relocate' | 'duplicates' | 'cues' | 'tags' | 'orphans' | 'quarantine' | 'stems';

interface IssueMeta {
  icon: React.ReactNode;
  title: StrKey;
  tip: StrKey;
  action: StrKey;
  /** strumento da aprire, oppure filtro della libreria da applicare */
  tool?: Tool;
  filter?: string;
}

const META: Partial<Record<IssueId, IssueMeta>> = {
  review: { icon: <FileWarning />, title: 'fix.i.review', tip: 'fix.tip.review', action: 'fix.a.show', filter: 'needsReview' },
  duplicates: { icon: <Copy />, title: 'fix.i.duplicates', tip: 'fix.tip.duplicates', action: 'fix.a.review', tool: 'duplicates' },
  noBpm: { icon: <Gauge />, title: 'fix.i.noBpm', tip: 'fix.tip.analyze', action: 'fix.a.show', filter: 'noBpm' },
  noKey: { icon: <KeyRound />, title: 'fix.i.noKey', tip: 'fix.tip.analyze', action: 'fix.a.show', filter: 'noKey' },
  noCues: { icon: <MapPin />, title: 'fix.i.noCues', tip: 'fix.tip.noCues', action: 'fix.a.add', tool: 'cues' },
  noGenre: { icon: <Tag />, title: 'fix.i.noGenre', tip: 'fix.tip.tags', action: 'fix.a.find', tool: 'tags' },
  noYear: { icon: <CalendarDays />, title: 'fix.i.noYear', tip: 'fix.tip.tags', action: 'fix.a.find', tool: 'tags' }
};

const TOOLS: { id: Tool; icon: React.ReactNode; title: StrKey; hint: StrKey }[] = [
  { id: 'relocate', icon: <FileSearch />, title: 'fix.t.relocate', hint: 'fix.t.relocateHint' },
  { id: 'orphans', icon: <FolderSearch />, title: 'fix.t.orphans', hint: 'fix.t.orphansHint' },
  { id: 'quarantine', icon: <Archive />, title: 'fix.t.quarantine', hint: 'fix.t.quarantineHint' },
  { id: 'stems', icon: <Layers />, title: 'fix.t.stems', hint: 'fix.t.stemsHint' }
];

export function FixScreen() {
  const t = useT();
  const { locale } = useAppState();
  const { health } = useLibrary();
  const { go } = useRouter();
  const [tool, setTool] = useState<Tool | null>(null);

  const all = healthIssues(health);
  const open = all.filter((i) => i.count > 0 && META[i.id]);
  const ok = all.filter((i) => i.count === 0 && META[i.id]);

  const act = (m: IssueMeta) => {
    if (m.tool) setTool(m.tool);
    else if (m.filter) go('library', undefined, { filter: m.filter });
  };

  const sheet = (id: Tool) => ({ open: tool === id, onOpenChange: (o: boolean) => setTool(o ? id : null) });

  return (
    <div className="space-y-6">
      <PageHeader title={t('nav.fix')} aside={health ? t('fix.score', { score: health.score }) : null} />

      {health && open.length === 0 ? (
        <EmptyState
          tone="success"
          icon={<FileSearch />}
          title={t('fix.allGood.title')}
          action={
            <Button variant="secondary" onClick={() => go('library')}>
              {t('nav.library')}
            </Button>
          }
        >
          {t('fix.allGood.body')}
        </EmptyState>
      ) : (
        <Section title={t('fix.todo')}>
          <ul className="divide-y divide-line-subtle">
            {open.map((i) => {
              const m = META[i.id]!;
              return (
                <li key={i.id} className="flex items-center gap-3 py-2.5">
                  <span className="grid size-8 shrink-0 place-items-center rounded-control bg-warning/10 text-warning [&_svg]:size-4">
                    {m.icon}
                  </span>
                  <span className="text-body text-ink-hi">{t(m.title)}</span>
                  <InfoTip text={t(m.tip)} />
                  <span className="ml-auto font-mono text-body tabular-nums text-ink-mid">
                    {i.count.toLocaleString(locale)}
                  </span>
                  <Button
                    size="sm"
                    variant={m.tool ? 'primary' : 'secondary'}
                    className="w-32 justify-center"
                    onClick={() => act(m)}
                  >
                    {t(m.action)}
                  </Button>
                </li>
              );
            })}
          </ul>
          {ok.length > 0 && (
            <p className="mt-3 text-caption text-ink-lo">
              {t('fix.okLine', { list: ok.map((i) => t(META[i.id]!.title)).join(' · ') })}
            </p>
          )}
        </Section>
      )}

      <Section title={t('fix.tools')}>
        <div className="grid gap-2 sm:grid-cols-2">
          {TOOLS.map((x) => (
            <button
              key={x.id}
              onClick={() => setTool(x.id)}
              className={cn(
                'group flex items-center gap-3 rounded-card border border-line-subtle px-3.5 py-3 text-left',
                'transition-colors duration-press hover:border-line-strong hover:bg-surface-hover'
              )}
            >
              <span className="grid size-8 shrink-0 place-items-center rounded-control bg-surface-3 text-ink-mid [&_svg]:size-4">
                {x.icon}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-body text-ink-hi">{t(x.title)}</span>
                <span className="block truncate text-caption text-ink-lo">{t(x.hint)}</span>
              </span>
              <ChevronRight className="size-4 text-ink-lo transition-transform duration-press group-hover:translate-x-0.5" />
            </button>
          ))}
        </div>
      </Section>

      <RelocateSheet {...sheet('relocate')} />
      <DuplicatesSheet {...sheet('duplicates')} />
      <AutoCueSheet {...sheet('cues')} />
      <TagsSheet {...sheet('tags')} />
      <OrphansSheet {...sheet('orphans')} />
      <QuarantineSheet {...sheet('quarantine')} />
      <StemsSheet {...sheet('stems')} />
    </div>
  );
}
