import {
  Activity,
  AudioLines,
  Brush,
  FolderSync,
  Gauge,
  HardDriveDownload,
  ListMusic,
  MapPin,
  Repeat,
  Settings2,
  Sheet,
  Sparkles,
  Trash2
} from 'lucide-react';
import type { MsgKey } from '@/lib/i18n';

/**
 * Architettura dell'informazione (§02 del design system).
 *
 * La V1 esponeva diciannove voci piatte, nove delle quali sparivano in modalità
 * Semplice. La V2 tiene tutte e diciannove le FUNZIONI ma le fa atterrare su
 * tredici destinazioni dentro sei gruppi semantici: le pagine che rispondevano
 * alla stessa domanda diventano tab della stessa destinazione, non voci che si
 * fanno concorrenza nella sidebar.
 *
 * Mappa di migrazione completa in docs/REDESIGN-NOTES.md.
 */

export type RouteId =
  | 'overview'
  | 'health'
  | 'tracks'
  | 'backup'
  | 'cleanup'
  | 'relocate'
  | 'enrich'
  | 'sets'
  | 'arrivals'
  | 'convert'
  | 'reports'
  | 'activity'
  | 'settings';

export type GroupId = 'library' | 'maintenance' | 'enrich' | 'sets' | 'export' | 'system';

export interface RouteTab {
  id: string;
  labelKey: MsgKey;
  /** tab visibile solo in modalità Esperto */
  expertOnly?: boolean;
}

export interface RouteDef {
  id: RouteId;
  group: GroupId;
  labelKey: MsgKey;
  icon: React.ReactNode;
  /** destinazione visibile solo in modalità Esperto */
  expertOnly?: boolean;
  tabs?: RouteTab[];
  /** contatore vivo mostrato sul bordo destro della sidebar */
  counter?: 'health' | 'tracks' | 'arrivals' | 'review';
}

export const GROUPS: { id: GroupId; labelKey: MsgKey }[] = [
  { id: 'library', labelKey: 'group.library' },
  { id: 'maintenance', labelKey: 'group.maintenance' },
  { id: 'enrich', labelKey: 'group.enrich' },
  { id: 'sets', labelKey: 'group.sets' },
  { id: 'export', labelKey: 'group.export' },
  { id: 'system', labelKey: 'group.system' }
];

export const ROUTES: RouteDef[] = [
  {
    id: 'overview',
    group: 'library',
    labelKey: 'nav.overview',
    icon: <Gauge />
  },
  {
    id: 'health',
    group: 'library',
    labelKey: 'nav.health',
    icon: <Activity />,
    counter: 'health'
  },
  {
    id: 'tracks',
    group: 'library',
    labelKey: 'nav.tracks',
    icon: <ListMusic />,
    counter: 'tracks'
  },
  {
    id: 'backup',
    group: 'maintenance',
    labelKey: 'nav.backup',
    icon: <HardDriveDownload />
  },
  {
    id: 'cleanup',
    group: 'maintenance',
    labelKey: 'nav.cleanup',
    icon: <Trash2 />,
    tabs: [
      { id: 'orphans', labelKey: 'tab.orphans' },
      { id: 'duplicates', labelKey: 'tab.duplicates', expertOnly: true },
      { id: 'quarantine', labelKey: 'tab.quarantine' }
    ]
  },
  {
    id: 'relocate',
    group: 'maintenance',
    labelKey: 'nav.relocate',
    icon: <MapPin />,
    expertOnly: true,
    tabs: [
      { id: 'byname', labelKey: 'tab.byName' },
      { id: 'byfingerprint', labelKey: 'tab.byFingerprint' }
    ]
  },
  {
    id: 'enrich',
    group: 'enrich',
    labelKey: 'nav.enrich',
    icon: <Brush />,
    expertOnly: true,
    tabs: [
      { id: 'cues', labelKey: 'tab.cues' },
      { id: 'tags', labelKey: 'tab.tags' },
      { id: 'stems', labelKey: 'tab.stems' }
    ]
  },
  {
    id: 'sets',
    group: 'sets',
    labelKey: 'nav.sets',
    icon: <Sparkles />,
    expertOnly: true,
    tabs: [
      { id: 'build', labelKey: 'tab.build' },
      { id: 'plan', labelKey: 'tab.plan' }
    ]
  },
  {
    id: 'arrivals',
    group: 'sets',
    labelKey: 'nav.arrivals',
    icon: <FolderSync />,
    expertOnly: true,
    counter: 'arrivals'
  },
  {
    id: 'convert',
    group: 'export',
    labelKey: 'nav.convert',
    icon: <Repeat />
  },
  {
    id: 'reports',
    group: 'export',
    labelKey: 'nav.reports',
    icon: <Sheet />,
    tabs: [
      { id: 'excel', labelKey: 'tab.excel' },
      { id: 'siae', labelKey: 'tab.siae' }
    ]
  },
  {
    id: 'activity',
    group: 'system',
    labelKey: 'nav.activity',
    icon: <AudioLines />
  },
  {
    id: 'settings',
    group: 'system',
    labelKey: 'nav.settings',
    icon: <Settings2 />,
    tabs: [
      { id: 'general', labelKey: 'tab.general' },
      { id: 'security', labelKey: 'tab.security' },
      { id: 'engine', labelKey: 'tab.engine' },
      { id: 'about', labelKey: 'tab.about' }
    ]
  }
];

export const ROUTE_BY_ID = Object.fromEntries(ROUTES.map((r) => [r.id, r])) as Record<
  RouteId,
  RouteDef
>;

/** Rotte visibili nella modalità corrente. */
export function visibleRoutes(expert: boolean): RouteDef[] {
  return ROUTES.filter((r) => expert || !r.expertOnly);
}

/** Tab visibili di una rotta nella modalità corrente. */
export function visibleTabs(route: RouteDef, expert: boolean): RouteTab[] {
  return (route.tabs ?? []).filter((t) => expert || !t.expertOnly);
}
