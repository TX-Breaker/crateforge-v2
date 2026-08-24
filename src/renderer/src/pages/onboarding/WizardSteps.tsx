import {
  Copy,
  Crown,
  Disc3,
  FolderSearch,
  HelpCircle,
  Layers,
  Library,
  Music4,
  Wrench
} from 'lucide-react';
import { Card, CardContent, Eyebrow } from '@/components/ui/card';
import { Checkbox, Notice, Segmented, Select, Switch, Tooltip } from '@/components/ui/misc';
import {
  DJ_APPS,
  IMPORT_SOURCES,
  importSource,
  type DjApp,
  type ImportSourceId
} from '@core/djRegistry';
import { cn } from '@/lib/utils';

/**
 * Le schermate aggiunte alla procedura di primo avvio.
 *
 * Stanno qui e non dentro `FirstRun.tsx` per una ragione pratica: quel file era
 * già lungo, e queste schermate servono anche fuori dal primo avvio — la
 * procedura è rieseguibile dalle impostazioni.
 *
 * Lo stile è quello esistente e basta: `Card`, `Eyebrow`, `Notice`, `Segmented`,
 * `Select`, `Switch`, icone `lucide-react`. Nessun componente nuovo, nessuna
 * classe inventata.
 */

/**
 * Perché l'utente è qui. Sono quattro situazioni diverse, non quattro modi di
 * dire la stessa cosa, e ognuna vuole un flusso diverso:
 *
 * - `convert`  — migrazione una tantum verso un altro programma. Finito quello,
 *                CrateForge non serve più.
 * - `organize` — rimettere in ordine la libreria: doppioni, tag, percorsi rotti.
 * - `hub`      — CrateForge è la libreria PRINCIPALE e scrive verso tutti gli
 *                altri. È il caso di chi cambia spesso programma o ha più
 *                attrezzature e vuole ritrovare la stessa libreria ovunque.
 * - `primary`  — un solo programma comanda (per esempio Rekordbox) e la sua
 *                libreria viene riversata sugli altri, che servono solo a
 *                suonare. La direzione è sempre la stessa, mai al contrario.
 *
 * ⚠ La differenza fra `hub` e `primary` non è di comodo: decide CHI vince in
 * caso di conflitto. Con `hub` la verità sta in CrateForge e le modifiche fatte
 * nei singoli programmi vi confluiscono; con `primary` la verità sta nel
 * programma principale e quello che si fa negli altri viene sovrascritto. Un
 * utente che sceglie male perde il lavoro fatto dalla parte sbagliata, quindi le
 * due voci vanno tenute distinte e spiegate.
 */
export type WizardGoal = 'convert' | 'organize' | 'hub' | 'primary';

type T = (k: string, p?: Record<string, string | number>) => string;

/* ------------------------------------------------------------------ passo 1 */

/**
 * «Cosa ti porta su CrateForge?»
 *
 * ⚠ La scelta RAMIFICA il resto della procedura, e per questo va fatta prima di
 * tutto: chi sta migrando una volta sola non deve sorbirsi le schermate sulle
 * funzioni di gestione, e chi vuole rimettere in ordine la libreria non deve
 * scoprire per caso che esistono.
 */
export function GoalStep({
  t,
  value,
  onChange
}: {
  t: T;
  value: WizardGoal | null;
  onChange: (g: WizardGoal) => void;
}) {
  const options: { id: WizardGoal; icon: typeof Disc3; titleKey: string; bodyKey: string }[] = [
    { id: 'convert', icon: Disc3, titleKey: 'goalConvertTitle', bodyKey: 'goalConvertBody' },
    { id: 'organize', icon: Wrench, titleKey: 'goalOrganizeTitle', bodyKey: 'goalOrganizeBody' },
    { id: 'hub', icon: Library, titleKey: 'goalHubTitle', bodyKey: 'goalHubBody' },
    { id: 'primary', icon: Crown, titleKey: 'goalPrimaryTitle', bodyKey: 'goalPrimaryBody' }
  ];

  return (
    <div className="space-y-4">
      <div>
        <Eyebrow>{t('goalEyebrow')}</Eyebrow>
        <h2 className="mt-1 text-title text-ink-hi">{t('goalTitle')}</h2>
        <p className="mt-1 max-w-2xl text-caption text-ink-mid">{t('goalBody')}</p>
      </div>

      <div
        className="grid gap-3 sm:grid-cols-2"
        role="radiogroup"
        aria-label={t('goalTitle')}
      >
        {options.map((o) => {
          const Icon = o.icon;
          const selected = value === o.id;
          return (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(o.id)}
              className="text-left"
            >
              <Card
                className={cn(
                  'h-full transition-colors duration-press',
                  selected ? 'border-accent bg-surface-2' : 'hover:border-line-strong'
                )}
              >
                <CardContent className="space-y-2 p-4">
                  <Icon className={cn('size-5', selected ? 'text-accent' : 'text-ink-mid')} />
                  <p className="text-body text-ink-hi">{t(o.titleKey)}</p>
                  <p className="text-caption text-ink-mid">{t(o.bodyKey)}</p>
                </CardContent>
              </Card>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ passo 2 */

/**
 * Vetrina delle funzioni di gestione.
 *
 * ⚠ REGOLA VINCOLANTE: qui compaiono solo funzioni che esistono davvero. Una
 * vetrina che promette smartlist, pulizia automatica dei metadati e ricerca nei
 * negozi mentre il programma non le ha è la cosa peggiore che questa procedura
 * possa fare: l'utente ci arriva convinto, e la delusione arriva dopo aver
 * importato la libreria.
 *
 * L'elenco è corto di proposito. Quando le funzioni mancanti verranno
 * implementate, si aggiunge una riga qui — non prima.
 */
const FEATURES = [
  { id: 'duplicates', icon: Copy, titleKey: 'featDupTitle', bodyKey: 'featDupBody' },
  { id: 'watcher', icon: FolderSearch, titleKey: 'featWatchTitle', bodyKey: 'featWatchBody' },
  { id: 'health', icon: Wrench, titleKey: 'featHealthTitle', bodyKey: 'featHealthBody' },
  { id: 'sync', icon: Layers, titleKey: 'featSyncTitle', bodyKey: 'featSyncBody' }
] as const;

export function FeaturesStep({ t }: { t: T }) {
  return (
    <div className="space-y-4">
      <div>
        <Eyebrow>{t('featEyebrow')}</Eyebrow>
        <h2 className="mt-1 text-title text-ink-hi">{t('featTitle')}</h2>
        <p className="mt-1 max-w-2xl text-caption text-ink-mid">{t('featBody')}</p>
      </div>

      <div className="space-y-2">
        {FEATURES.map((f) => {
          const Icon = f.icon;
          return (
            <Card key={f.id}>
              <CardContent className="flex gap-3 p-4">
                <Icon className="mt-0.5 size-4 shrink-0 text-accent" />
                <div className="min-w-0">
                  <p className="text-body text-ink-hi">{t(f.titleKey)}</p>
                  <p className="mt-0.5 text-caption text-ink-mid">{t(f.bodyKey)}</p>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Dire cosa NON c'è ancora vale quanto dire cosa c'è. */}
      <Notice variant="info" title={t('featSoonTitle')}>
        {t('featSoonBody')}
      </Notice>
    </div>
  );
}

/* ------------------------------------------------------------------ passo 3 */

/** «Da quale app DJ stai importando?» — griglia a due colonne. */
export function AppGridStep({
  t,
  value,
  onChange
}: {
  t: T;
  value: string | null;
  onChange: (id: string) => void;
}) {
  return (
    <div className="space-y-4">
      <div>
        <Eyebrow>{t('appEyebrow')}</Eyebrow>
        <h2 className="mt-1 text-title text-ink-hi">{t('appTitle')}</h2>
        <p className="mt-1 max-w-2xl text-caption text-ink-mid">{t('appBody')}</p>
      </div>

      <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label={t('appTitle')}>
        {DJ_APPS.map((a) => {
          const selected = value === a.id;
          /* Un'app le cui sorgenti non sono ancora implementate si mostra
             spenta con il motivo: toglierla lascerebbe l'utente a chiedersi se
             ha guardato male. */
          const usable = a.sources.length === 0 || a.sources.some((s) => importSource(s).available);
          return (
            <button
              key={a.id}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={!usable}
              onClick={() => onChange(a.id)}
              className="text-left disabled:cursor-not-allowed disabled:opacity-45"
            >
              <Card
                className={cn(
                  'transition-colors duration-press',
                  selected ? 'border-accent bg-surface-2' : usable ? 'hover:border-line-strong' : ''
                )}
              >
                <CardContent className="flex items-center gap-3 p-3">
                  {a.id === 'none' ? (
                    <Music4 className={cn('size-4', selected ? 'text-accent' : 'text-ink-low')} />
                  ) : (
                    <Disc3 className={cn('size-4', selected ? 'text-accent' : 'text-ink-low')} />
                  )}
                  <span className="text-body text-ink-hi">{t(a.labelKey)}</span>
                  {!usable && (
                    <span className="ml-auto text-caption text-ink-low">{t('srcNotYet')}</span>
                  )}
                </CardContent>
              </Card>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ passo 4 */

export interface ImportChoices {
  source: ImportSourceId | null;
  /** quali cue portare dentro */
  cueKind: 'hot' | 'memory' | 'both';
  duplicateCues: boolean;
  originalLocations: boolean;
  /** ⚠ attivo di default: l'import AGGIUNGE, non sostituisce */
  merge: boolean;
}

export const DEFAULT_IMPORT_CHOICES: ImportChoices = {
  source: null,
  cueKind: 'both',
  duplicateCues: false,
  originalLocations: true,
  merge: true
};

/** Sorgenti suggerite per l'app scelta, poi tutte le altre. */
function orderedSources(app: DjApp | null) {
  if (!app) return IMPORT_SOURCES;
  const preferite = new Set<ImportSourceId>(app.sources);
  return [
    ...IMPORT_SOURCES.filter((s) => preferite.has(s.id)),
    ...IMPORT_SOURCES.filter((s) => !preferite.has(s.id))
  ];
}

/**
 * Pannello di import: selettore delle sorgenti, opzioni per sorgente, e
 * l'interruttore «Unisci».
 *
 * ⚠ Il selettore è alimentato dal registro (`@core/djRegistry`), non da una
 * lista scritta qui. È il punto del mandato: un adapter nuovo compare in questa
 * schermata senza che nessuno se ne ricordi.
 */
export function ImportPanelStep({
  t,
  appId,
  choices,
  onChange
}: {
  t: T;
  appId: string | null;
  choices: ImportChoices;
  onChange: (c: ImportChoices) => void;
}) {
  const app = DJ_APPS.find((a) => a.id === appId) ?? null;
  const sources = orderedSources(app);
  const current = choices.source ? importSource(choices.source) : null;
  const options = current?.options ?? [];

  const set = <K extends keyof ImportChoices>(k: K, v: ImportChoices[K]) =>
    onChange({ ...choices, [k]: v });

  const hint = (key: string) => (
    <Tooltip content={t(key)}>
      <HelpCircle className="size-3.5 shrink-0 text-ink-low" aria-label={t(key)} />
    </Tooltip>
  );

  return (
    <div className="space-y-4">
      <div>
        <Eyebrow>{t('impEyebrow')}</Eyebrow>
        <h2 className="mt-1 text-title text-ink-hi">{t('impTitle')}</h2>
        <p className="mt-1 max-w-2xl text-caption text-ink-mid">{t('impBody')}</p>
      </div>

      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="space-y-1.5">
            <p className="text-caption text-ink-mid">{t('impFrom')}</p>
            <Select
              label={t('impFrom')}
              value={choices.source ?? ''}
              onValueChange={(v) => set('source', v as ImportSourceId)}
              placeholder={t('impPick')}
              options={sources.map((s) => ({
                value: s.id,
                label: t(s.labelKey),
                hint: s.available ? undefined : t(s.unavailableKey ?? 'srcNotYet')
              }))}
            />
          </div>

          {current && !current.available && (
            <Notice variant="warning" title={t('srcNotYet')}>
              {t(current.unavailableKey ?? 'srcNotYet')}
            </Notice>
          )}

          {options.includes('cueKind') && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5">
                <p className="text-caption text-ink-mid">{t('optCueKind')}</p>
                {hint('optCueKindHelp')}
              </div>
              <Segmented
                value={choices.cueKind}
                onChange={(v) => set('cueKind', v as ImportChoices['cueKind'])}
                options={[
                  { value: 'hot', label: t('optCueHot') },
                  { value: 'memory', label: t('optCueMemory') },
                  { value: 'both', label: t('optCueBoth') }
                ]}
              />
            </div>
          )}

          {options.includes('duplicateCues') && (
            <label className="flex items-start gap-2.5">
              <Checkbox
                checked={choices.duplicateCues}
                onCheckedChange={(v) => set('duplicateCues', v === true)}
              />
              <span className="min-w-0">
                <span className="flex items-center gap-1.5">
                  <span className="text-body text-ink-hi">{t('optDupCues')}</span>
                  {hint('optDupCuesHelp')}
                </span>
              </span>
            </label>
          )}

          {options.includes('originalLocations') && (
            <label className="flex items-start gap-2.5">
              <Checkbox
                checked={choices.originalLocations}
                onCheckedChange={(v) => set('originalLocations', v === true)}
              />
              <span className="min-w-0">
                <span className="flex items-center gap-1.5">
                  <span className="text-body text-ink-hi">{t('optOrigLoc')}</span>
                  {hint('optOrigLocHelp')}
                </span>
              </span>
            </label>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <label className="flex items-center gap-3">
            <Switch checked={choices.merge} onCheckedChange={(v) => set('merge', v)} />
            <span className="min-w-0">
              <span className="block text-body text-ink-hi">{t('optMerge')}</span>
              {/* ⚠ La garanzia va scritta, non sottintesa: è la domanda che
                  l'utente si fa davvero prima di premere Importa. */}
              <span className="block text-caption text-ink-mid">{t('optMergeBody')}</span>
            </span>
          </label>
        </CardContent>
      </Card>
    </div>
  );
}
