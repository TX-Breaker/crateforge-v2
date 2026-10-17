import { CalendarRange, HardDriveDownload, ListMusic, ListOrdered, RefreshCw, Settings2, Sheet, Wrench } from 'lucide-react';
import type { StrKey } from '@/lib/strings';

/**
 * Le sette destinazioni dell'interfaccia.
 *
 * Erano tredici in sei gruppi, più una modalità Esperto che ne nascondeva
 * metà. Si sono ridotte rispondendo a una domanda per voce — che cosa sono
 * venuto a fare? — invece che a una funzione per voce:
 *
 *  - Libreria       vedere che cosa ho
 *  - Da sistemare   rimettere a posto quello che non va
 *  - Sincronizza    portare la libreria negli altri programmi
 *  - Set            preparare una serata
 *  - Backup         non perdere niente
 *  - Report         documentare (Excel, SIAE, cronologia)
 *  - Impostazioni
 *
 * Non c'è più la modalità Esperto: niente di ciò che nascondeva era
 * pericoloso, e ciò che è pericoloso è protetto dai permessi di scrittura in
 * Impostazioni, non dalla visibilità di una voce.
 */

export type RouteId = 'library' | 'fix' | 'sync' | 'sets' | 'playlists' | 'backup' | 'reports' | 'settings';

export interface RouteDef {
  id: RouteId;
  labelKey: StrKey;
  icon: React.ReactNode;
  /** Contatore sul bordo destro della voce. */
  counter?: 'tracks' | 'issues';
  /** Le ultime voci stanno in fondo alla colonna, separate. */
  bottom?: boolean;
}

export const ROUTES: RouteDef[] = [
  { id: 'library', labelKey: 'nav.library', icon: <ListMusic />, counter: 'tracks' },
  { id: 'fix', labelKey: 'nav.fix', icon: <Wrench />, counter: 'issues' },
  { id: 'sync', labelKey: 'nav.sync', icon: <RefreshCw /> },
  { id: 'sets', labelKey: 'nav.sets', icon: <CalendarRange /> },
  { id: 'playlists', labelKey: 'nav.playlists', icon: <ListOrdered /> },
  { id: 'backup', labelKey: 'nav.backup', icon: <HardDriveDownload /> },
  { id: 'reports', labelKey: 'nav.reports', icon: <Sheet /> },
  { id: 'settings', labelKey: 'nav.settings', icon: <Settings2 />, bottom: true }
];

export const ROUTE_BY_ID: Record<RouteId, RouteDef> = Object.fromEntries(
  ROUTES.map((r) => [r.id, r])
) as Record<RouteId, RouteDef>;

export const isRouteId = (v: string): v is RouteId => v in ROUTE_BY_ID;
