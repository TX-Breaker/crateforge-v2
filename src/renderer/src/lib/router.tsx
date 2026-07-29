import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { ROUTE_BY_ID, visibleTabs, type RouteId } from '@/app/routes';
import { useAppState } from './appState';

/**
 * Router interno tipizzato. Niente URL: l'app è una finestra sola, e un router
 * completo costerebbe più di quanto renda. Quello che serve davvero è qui:
 * rotta + tab attiva, memoria della posizione di scroll per rotta, e un piccolo
 * stack indietro/avanti per le scorciatoie.
 */

export interface Location {
  route: RouteId;
  tab?: string;
  /** contesto opzionale passato alla destinazione (es. una ricerca da ⌘K) */
  params?: Record<string, string>;
}

interface RouterApi extends Location {
  go: (route: RouteId, tab?: string, params?: Record<string, string>) => void;
  setTab: (tab: string) => void;
  back: () => void;
  canGoBack: boolean;
  /** scroll memorizzato per rotta, gestito dal contenitore della shell */
  scrollFor: (route: RouteId) => number;
  rememberScroll: (route: RouteId, top: number) => void;
}

const Ctx = createContext<RouterApi | null>(null);

export function RouterProvider({ children }: { children: React.ReactNode }) {
  const { mode } = useAppState();
  const [loc, setLoc] = useState<Location>({ route: 'overview' });
  const [stack, setStack] = useState<Location[]>([]);
  const scrolls = useRef<Map<RouteId, number>>(new Map());

  const expert = mode === 'expert';

  // Se si torna in Semplice mentre si è su una destinazione Esperto, si rientra
  // in Panoramica: stessa regola della V1, applicata anche alle tab.
  const safeLoc = useMemo<Location>(() => {
    const def = ROUTE_BY_ID[loc.route];
    if (!def || (def.expertOnly && !expert)) return { route: 'overview' };
    const tabs = visibleTabs(def, expert);
    if (tabs.length === 0) return { route: loc.route, params: loc.params };
    const tab = tabs.some((t) => t.id === loc.tab) ? loc.tab : tabs[0].id;
    return { route: loc.route, tab, params: loc.params };
  }, [loc, expert]);

  const go = useCallback(
    (route: RouteId, tab?: string, params?: Record<string, string>) => {
      setStack((s) => [...s, safeLoc].slice(-20));
      setLoc({ route, tab, params });
    },
    [safeLoc]
  );

  const value = useMemo<RouterApi>(
    () => ({
      ...safeLoc,
      go,
      setTab: (tab: string) => setLoc((l) => ({ ...l, tab })),
      back: () =>
        setStack((s) => {
          const prev = s[s.length - 1];
          if (prev) setLoc(prev);
          return s.slice(0, -1);
        }),
      canGoBack: stack.length > 0,
      scrollFor: (route) => scrolls.current.get(route) ?? 0,
      rememberScroll: (route, top) => scrolls.current.set(route, top)
    }),
    [safeLoc, go, stack.length]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useRouter(): RouterApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('useRouter fuori dal provider');
  return v;
}
