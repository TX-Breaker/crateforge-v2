import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { ROUTE_BY_ID, type RouteId } from '@/app/routes';

/**
 * Navigazione interna: una destinazione, un'eventuale tab, e parametri per
 * aprire una schermata già nel punto giusto (per esempio la Libreria filtrata
 * su una tonalità, o Da sistemare con uno strumento già aperto).
 */

export interface Location {
  route: RouteId;
  tab?: string;
  params?: Record<string, string>;
}

interface RouterApi extends Location {
  go: (route: RouteId, tab?: string, params?: Record<string, string>) => void;
  setTab: (tab: string) => void;
  back: () => void;
  canGoBack: boolean;
  scrollFor: (route: RouteId) => number;
  rememberScroll: (route: RouteId, top: number) => void;
}

const Ctx = createContext<RouterApi | null>(null);

export function RouterProvider({ children }: { children: React.ReactNode }) {
  const [loc, setLoc] = useState<Location>({ route: 'library' });
  const [stack, setStack] = useState<Location[]>([]);
  const scrolls = useRef<Map<RouteId, number>>(new Map());

  const go = useCallback((route: RouteId, tab?: string, params?: Record<string, string>) => {
    if (!ROUTE_BY_ID[route]) return;
    setLoc((cur) => {
      setStack((s) => [...s.slice(-19), cur]);
      return { route, tab, params };
    });
  }, []);

  const value = useMemo<RouterApi>(
    () => ({
      ...loc,
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
    [loc, go, stack.length]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useRouter(): RouterApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('useRouter fuori dal provider');
  return v;
}
