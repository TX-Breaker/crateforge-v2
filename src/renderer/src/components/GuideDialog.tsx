import { BookOpen } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { useAppState } from '@/lib/appState';
import { pageText } from '@/lib/i18nPages';

/**
 * Guida visiva passo-passo (§4: istruzioni integrate, non solo testo) per le
 * due operazioni manuali che Rekordbox richiede:
 *  - exportXml: esportare la collection in XML (per la modalità solo-XML);
 *  - importXml: importare in Rekordbox un XML generato da CrateForge.
 * Le illustrazioni sono schemi disegnati (niente screenshot proprietari
 * dell'interfaccia Pioneer/AlphaTheta): mostrano DOVE cliccare, in ordine.
 */

export type GuideKind = 'exportXml' | 'importXml';

interface Step {
  titleKey: string;
  bodyKey: string;
  art: React.ReactNode;
}

/** Mini-illustrazioni schematiche riusabili. */
function MenuArt({ items, highlight }: { items: string[]; highlight: number }) {
  return (
    <svg viewBox="0 0 220 90" className="h-24 w-full rounded-card border border-line-subtle bg-surface-3">
      <rect x="0" y="0" width="220" height="16" className="fill-surface-3" />
      <text x="8" y="11" fontSize="8" className="fill-ink-hi font-sans">
        File   View   Track   Help
      </text>
      {items.map((it, i) => (
        <g key={i}>
          <rect
            x="6"
            y={22 + i * 20}
            width="150"
            height="16"
            rx="3"
            className={i === highlight ? 'fill-accent' : 'fill-surface-3'}
          />
          <text
            x="12"
            y={33 + i * 20}
            fontSize="8"
            className={i === highlight ? 'fill-accent-ink font-sans' : 'fill-ink-hi font-sans'}
          >
            {it}
          </text>
        </g>
      ))}
      {highlight >= 0 && (
        <text x="168" y={33 + highlight * 20} fontSize="12" className="fill-accent font-sans">
          ← 🖱
        </text>
      )}
    </svg>
  );
}

function PrefsArt({ pathLabel, fieldLabel }: { pathLabel: string; fieldLabel: string }) {
  return (
    <svg viewBox="0 0 220 90" className="h-24 w-full rounded-card border border-line-subtle bg-surface-3">
      <rect x="0" y="0" width="70" height="90" className="fill-surface-3" />
      <text x="6" y="16" fontSize="7" className="fill-ink-hi font-sans">General</text>
      <text x="6" y="32" fontSize="7" className="fill-ink-hi font-sans">Audio</text>
      <rect x="2" y="40" width="66" height="14" rx="3" className="fill-accent" />
      <text x="6" y="50" fontSize="7" className="fill-accent-ink font-sans">Advanced</text>
      <text x="80" y="20" fontSize="8" className="fill-ink-hi font-sans">{pathLabel}</text>
      <rect x="80" y="30" width="130" height="16" rx="3" className="fill-surface-2 stroke-accent" strokeWidth="1.5" />
      <text x="86" y="41" fontSize="7" className="fill-ink-lo font-sans">{fieldLabel}</text>
      <text x="80" y="66" fontSize="10" className="fill-accent font-sans">↑ 🖱</text>
    </svg>
  );
}

function TreeArt({ rootLabel, itemLabel, action }: { rootLabel: string; itemLabel: string; action: string }) {
  return (
    <svg viewBox="0 0 220 90" className="h-24 w-full rounded-card border border-line-subtle bg-surface-3">
      <text x="8" y="16" fontSize="8" className="fill-ink-hi font-sans">▸ Collection</text>
      <text x="8" y="34" fontSize="8" className="fill-ink-hi font-sans">▾ {rootLabel}</text>
      <rect x="18" y="42" width="120" height="15" rx="3" className="fill-accent" />
      <text x="24" y="53" fontSize="8" className="fill-accent-ink font-sans">{itemLabel}</text>
      <rect x="120" y="60" width="94" height="16" rx="3" className="fill-surface-2 stroke-accent" strokeWidth="1.5" />
      <text x="126" y="71" fontSize="7" className="fill-ink-hi font-sans">{action}</text>
    </svg>
  );
}

export function GuideDialog({
  kind,
  open,
  onOpenChange
}: {
  kind: GuideKind;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { locale } = useAppState();
  const tg = (k: string) => pageText(locale, 'guide', k);

  const steps: Step[] =
    kind === 'exportXml'
      ? [
          { titleKey: 'exp1t', bodyKey: 'exp1b', art: <MenuArt items={['Export Collection in xml format', 'Library…', 'Preferences…']} highlight={0} /> },
          { titleKey: 'exp2t', bodyKey: 'exp2b', art: <PrefsArt pathLabel={tg('artSaveAs')} fieldLabel="collection.xml" /> },
          { titleKey: 'exp3t', bodyKey: 'exp3b', art: <TreeArt rootLabel="CrateForge" itemLabel="collection.xml" action={tg('artImportBtn')} /> }
        ]
      : [
          { titleKey: 'imp1t', bodyKey: 'imp1b', art: <PrefsArt pathLabel="Preferences → Advanced → Database" fieldLabel="rekordbox xml: crateforge-*.xml" /> },
          { titleKey: 'imp2t', bodyKey: 'imp2b', art: <TreeArt rootLabel="rekordbox xml" itemLabel="Playlists / All Tracks" action="" /> },
          { titleKey: 'imp3t', bodyKey: 'imp3b', art: <TreeArt rootLabel="rekordbox xml" itemLabel={tg('artTracks')} action="Import to Collection" /> },
          { titleKey: 'imp4t', bodyKey: 'imp4b', art: <MenuArt items={[tg('artCheck1'), tg('artCheck2')]} highlight={-1} /> }
        ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookOpen className="h-5 w-5" />
            {kind === 'exportXml' ? tg('exportTitle') : tg('importTitle')}
          </DialogTitle>
        </DialogHeader>
        <p className="text-caption text-ink-lo">{tg('schematicNote')}</p>
        <div className="space-y-5">
          {steps.map((s, i) => (
            <div key={i} className="space-y-1.5">
              <div className="flex items-center gap-2 text-body font-medium text-ink-hi">
                <span className="grid size-5 shrink-0 place-items-center rounded-full bg-accent font-mono text-[10px] text-accent-ink">
                  {i + 1}
                </span>
                {tg(s.titleKey)}
              </div>
              <p className="pl-7 text-caption text-ink-mid">{tg(s.bodyKey)}</p>
              <div className="pl-7">{s.art}</div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
